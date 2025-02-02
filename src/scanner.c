#include "tree_sitter/array.h"
#include "tree_sitter/parser.h"

#include <assert.h>
#include <stdint.h>
#include <stdio.h>
#include <string.h>

#define DEBUG 0  // Set to 1 to enable debug logging, 0 to disable

#if DEBUG
    #define DEBUG(fmt, ...) fprintf(stderr, "DEBUG: " fmt "\n", ##__VA_ARGS__)
#else
    #define DEBUG(fmt, ...)
#endif

// Define token types recognized by the external scanner.
enum TokenType
{
    NEWLINE,
    INDENT,
    DEDENT,
    STRING_START,
    STRING_CONTENT,
    STRING_END,
    COMMENT,
    CLOSE_PAREN,
    CLOSE_BRACKET,
    CLOSE_BRACE,
};

// Flags to describe string delimiters (single quote, double quote, etc.) and
// string modifiers (raw, triple, bytes).
typedef enum
{
    SingleQuote = 1 << 0,
    DoubleQuote = 1 << 1,
    Backtick = 1 << 2,
    Raw = 1 << 3,
    Triple = 1 << 4,
} Flags;

// Structure to represent a string delimiter.
typedef struct
{
    char flags;                                 // Stores the delimiter type and modifiers using the Flags enum.
    uint8_t num_whitespace_prefixing_end_delim; // Defaults to 0
} Delimiter;

// Helper functions to create and manipulate delimiters.
static inline Delimiter new_delimiter() { return (Delimiter){0, 0}; }

static inline bool is_raw(Delimiter *delimiter) { return delimiter->flags & Raw; }

static inline bool is_triple(Delimiter *delimiter) { return delimiter->flags & Triple; }

// Returns the character used to end the current string delimiter.
static inline int32_t end_character(Delimiter *delimiter)
{
    if (delimiter->flags & SingleQuote)
    {
        return '\'';
    }
    if (delimiter->flags & DoubleQuote)
    {
        return '"';
    }
    if (delimiter->flags & Backtick)
    {
        return '`';
    }
    return 0;
}

// Helper functions to set delimiter flags.
static inline void set_raw(Delimiter *delimiter) { delimiter->flags |= Raw; }

static inline void set_triple(Delimiter *delimiter) { delimiter->flags |= Triple; }

// Sets the appropriate flag based on the delimiter character.
static inline void set_end_character(Delimiter *delimiter, int32_t character)
{
    switch (character)
    {
    case '\'':
        delimiter->flags |= SingleQuote;
        break;
    case '"':
        delimiter->flags |= DoubleQuote;
        break;
    case '`':
        delimiter->flags |= Backtick;
        break;
    default:
        assert(false);
    }
}

// The main scanner structure.
typedef struct
{
    Array(uint16_t) indents;     // Stack to track indentation levels.
    Array(Delimiter) delimiters; // Stack to track nested string delimiters.
    bool inside_raw_string;      // Tracks if a raw string is currently being processed.
} Scanner;

// Helper functions to advance the lexer.
static inline void advance(TSLexer *lexer)
{
    if (lexer->lookahead != 0)
    {
        DEBUG("Consuming '%c'", lexer->lookahead);
    }
    lexer->advance(lexer, false);
}

static inline void skip(TSLexer *lexer)
{
    DEBUG("Skipping  '%c'", lexer->lookahead);
    lexer->advance(lexer, true);
}

static inline bool try_consume_triple_end(TSLexer *lexer, int32_t end_char)
{
    // expecting to be invoked only when we see first potential end_char and we are in a triple

    for (int i = 0; i < 3; i++)
    {
        if (lexer->lookahead == end_char)
        {
            advance(lexer);
        }
        else
        {
            return false;
        }
    }
    return true;
}

static bool consume_only_whitespace_and_comment_then_newline(TSLexer *lexer)
{
    // In theory, we want to 'skip' chars matched in this function, but due to the below tree sitter Issues,
    // we can't do that, so we advance instead.
    // https://github.com/tree-sitter/tree-sitter/issues/2315
    // https://github.com/tree-sitter/tree-sitter/issues/2985
    for (;;)
    {
        switch (lexer->lookahead)
        {
        // If we hit newline or EOF, we’re good
        case '\r':
            advance(lexer);
        case '\n':
            // in case we hit above \r and it's followed by \n
            if (lexer->lookahead == '\n')
            {
                // do not include opening newline in content, so skip
                advance(lexer);
            }
        case 0:
            return true;

        // If it’s normal whitespace, consume it and keep going
        case ' ':
        case '\t':
            advance(lexer);
            break;

        case '/':
            advance(lexer);
            if (lexer->lookahead == '/')
            {
                advance(lexer);
                while (lexer->lookahead != '\r' && lexer->lookahead != '\n' && lexer->lookahead != 0)
                {
                    advance(lexer);
                }
                if (lexer->lookahead == '\r')
                {
                    advance(lexer);
                }
                if (lexer->lookahead == '\n')
                {
                    advance(lexer);
                }
                return true;
            }
            else
            {
                // Found a slash that doesn't begin a comment => not valid
                return false;
            }
            break;

        // If we find any other character that is not whitespace,
        // that means the line is not empty => fail
        default:
            return false;
        }
    }
}

static void lookahead_check_ending_delim_whitespace_prefix(TSLexer *lexer, Delimiter *delimiter)
{
    // Tracks how many spaces/tabs we’ve seen *so far on this line*.
    // We only increment this if the line has contained no non-whitespace characters.
    int line_whitespace_count = 0;

    // True if we've encountered anything other than whitespace on the current line.
    // If so, the line is no longer “purely whitespace so far.”
    bool line_has_non_whitespace = false;

    // How many consecutive double quotes have we seen so far?
    // We only increment this if we haven't broken the “pure whitespace then quotes” rule.
    int consecutive_quotes = 0;

    // How many whitespace characters appeared *right before* the first quote in a run?
    // This is what we end up assigning to `delimiter->num_whitespace_prefixing_end_delim`.
    int prefix_before_quotes = 0;

    for (;;)
    {
        switch (lexer->lookahead)
        {
        case 0:
            DEBUG("Hit EOF - bad!");
            return;
        case ' ':
        case '\t':
            // If we haven't seen any non-whitespace yet, this might be indentation.
            if (!line_has_non_whitespace)
            {
                line_whitespace_count++;
            }
            // If we are in the middle of counting consecutive quotes, a space here means
            // they’re no longer consecutive. We “break” that quote run.
            if (consecutive_quotes > 0)
            {
                line_has_non_whitespace = true;
                consecutive_quotes = 0;
            }
            break;

        case '\n':
            // New line: reset everything for the fresh line.
            line_whitespace_count = 0;
            line_has_non_whitespace = false;
            consecutive_quotes = 0;
            break;

        case '"':
            // We only count quotes if up until now the line has been “pure whitespace.”
            if (!line_has_non_whitespace)
            {
                // If this is the first quote in a run, record the current line indentation
                // as the “prefix” that’s in front of these quotes.
                if (consecutive_quotes == 0)
                {
                    prefix_before_quotes = line_whitespace_count;
                }
                consecutive_quotes++;
            }
            else
            {
                // If we've already encountered non-whitespace on this line,
                // or we've broken the consecutive run, reset it.
                consecutive_quotes = 0;
            }
            break;

        default:
            // Any other character: the line is no longer “pure whitespace,”
            // so we can’t accept `"""` on this line as purely whitespace-delimited.
            line_has_non_whitespace = true;
            consecutive_quotes = 0;
            break;
        }

        // If we’ve just hit three consecutive quotes, that’s our delimiter!
        if (consecutive_quotes == 3)
        {
            // The indentation in front of the first of those three quotes is the count we need.
            delimiter->num_whitespace_prefixing_end_delim = prefix_before_quotes;
            return;
        }

        // *Should* be skip - 'Find' in this doc "2315" for info.
        advance(lexer);
    }
}

static int strip_prefix_ws(TSLexer *lexer, int to_strip, bool do_skip)
{
    int remaining = to_strip;
    while (remaining > 0 && (lexer->lookahead == ' ' || lexer->lookahead == '\t'))
    {
        if (do_skip)
        {
            skip(lexer);
        }
        else
        {
            advance(lexer);
        }
        remaining--;
    }
    return remaining;
}

// The core external scanner function.
bool tree_sitter_rsl_external_scanner_scan(void *payload, TSLexer *lexer, const bool *valid_symbols)
{
    Scanner *scanner = (Scanner *)payload;

    // Special handling for error recovery mode and when within brackets.
    bool error_recovery_mode = valid_symbols[STRING_CONTENT] && valid_symbols[INDENT];
    bool within_brackets = valid_symbols[CLOSE_BRACE] || valid_symbols[CLOSE_PAREN] || valid_symbols[CLOSE_BRACKET];

    // Handle string content.
    DEBUG("Checking if handle string content...");
    if (valid_symbols[STRING_CONTENT] && scanner->delimiters.size > 0)
    {
        DEBUG("Yep, handling");
        Delimiter *delimiter = array_back(&scanner->delimiters);
        int32_t end_char = end_character(delimiter);
        // keep track of whether we've encountered any content.
        bool has_content = false;
        // if in triple, this is # of whitespace prefix chars to strip from each line.
        int to_strip = delimiter->num_whitespace_prefixing_end_delim;

        if (is_triple(delimiter) && lexer->lookahead == '\n')
        {
            advance(lexer);
            lexer->mark_end(lexer);
            int remaining = strip_prefix_ws(lexer, to_strip, false);
            if (remaining > 0 && lexer->lookahead != '\n')
            {
                // invalid multistring
                return false;
            }
            if (lexer->lookahead == '\n')
            {
                // another newline, leave for next iteration
                lexer->result_symbol = STRING_CONTENT;
                return true;
            }
            // consumed leading whitespace, check if triple end
            for (int i = 0; i < 3; i++)
            {
                if (lexer->lookahead == '"')
                {
                    advance(lexer);
                }
                else
                {
                    // it's not triple end, just return the sole newline as content
                    lexer->result_symbol = STRING_CONTENT;
                    return true;
                }
            }
            // it *is* triple end, end the string!
            lexer->mark_end(lexer);
            array_pop(&scanner->delimiters);
            lexer->result_symbol = STRING_END;
            scanner->inside_raw_string = false;
            return true;

        }

        DEBUG("Stripping %c %d", lexer->lookahead, to_strip);
        int remaining = strip_prefix_ws(lexer, to_strip, true);
        if (remaining > 0)
        {
            // invalid multistring
            return false;
        }

        while (lexer->lookahead)
        {
            // Check for escape interpolation start within the string.
            if (lexer->lookahead == '{' && !is_raw(delimiter))
            {
                // about to start an interpolation -- exit and let TS grammar handle it
                lexer->mark_end(lexer);
                lexer->result_symbol = STRING_CONTENT;
                return has_content;
            }

            // Handle escape sequences.
            if (lexer->lookahead == '\\' && !is_raw(delimiter))
            {
                // In regular strings, backslash indicates an escape sequence, let TS grammar handle it
                lexer->mark_end(lexer);
                lexer->result_symbol = STRING_CONTENT;
                return has_content;
            }

            if (lexer->lookahead == end_char)
            {
                // we're seeing a possible end to our string, handle
                if (is_triple(delimiter))
                {
                    // we're expecting a triple end_char

                    if (has_content)
                    {
                        // we already have some content, so let's move up our marker
                        lexer->mark_end(lexer);
                        lexer->result_symbol = STRING_CONTENT;
                    }

                    if (try_consume_triple_end(lexer, end_char))
                    {
                        // we were able to read our triple ending

                        if (!has_content)
                        {
                            // if we didn't have content before, we just need to emit our string ending.
                            // otherwise, we'll leave our content-emitting market and symbol.
                            lexer->mark_end(lexer);
                            array_pop(&scanner->delimiters);
                            lexer->result_symbol = STRING_END;
                            scanner->inside_raw_string = false;
                        }
                        return true;
                    }
                    has_content = true;
                }
                else
                {
                    if (has_content)
                    {
                        // for single-quoted strings, a single delimiter ends the string.
                        lexer->result_symbol = STRING_CONTENT;
                    }
                    else
                    {
                        advance(lexer);
                        array_pop(&scanner->delimiters);
                        lexer->result_symbol = STRING_END;
                        scanner->inside_raw_string = false;
                    }
                    lexer->mark_end(lexer);
                    return true;
                }
            }
            else if (lexer->lookahead == '\n')
            {
                if (!is_triple(delimiter))
                {
                    // 'Genuine (unescaped) newlines are not allowed in single-quoted strings.
                    return false;
                }

                // We *are* in a triple-quoted string

                lexer->mark_end(lexer);
                lexer->result_symbol = STRING_CONTENT;

                // we don't include the newline *yet*. we let the next iteration
                // check if the newline prefixes the end of the triple string. if it does,
                // we'll exclude the newline from the content.

                return true;
            }

            advance(lexer);
            has_content = true;
        }
    }

    lexer->mark_end(lexer);

    // Handle indentation and newlines.
    bool found_end_of_line = false;
    uint16_t indent_length = 0;
    int32_t first_comment_indent_length = -1; // Indentation level of the first comment on a line.
    for (;;)
    {
        if (lexer->lookahead == '\n')
        {
            found_end_of_line = true;
            indent_length = 0;
            skip(lexer);
        }
        else if (lexer->lookahead == ' ')
        {
            indent_length++;
            skip(lexer);
        }
        else if (lexer->lookahead == '\r' || lexer->lookahead == '\f')
        {
            indent_length = 0;
            skip(lexer);
        }
        else if (lexer->lookahead == '\t')
        {
            indent_length += 8;
            skip(lexer);
        }
        // todo //-style comments
        else if (lexer->lookahead == '#' && (valid_symbols[INDENT] || valid_symbols[DEDENT] ||
                                             valid_symbols[NEWLINE]))
        {
            // Handle comments.
            if (!found_end_of_line)
            {
                // Comment is on the same line as code, so ignore it for indentation purposes.
                return false;
            }
            if (first_comment_indent_length == -1)
            {
                first_comment_indent_length = (int32_t)indent_length;
            }
            while (lexer->lookahead && lexer->lookahead != '\n')
            {
                skip(lexer);
            }
            skip(lexer);
            indent_length = 0;
        }
        else if (lexer->lookahead == '\\')
        {
            // Handle backslash continuation.
            skip(lexer);
            if (lexer->lookahead == '\r')
            {
                skip(lexer);
            }
            if (lexer->lookahead == '\n' || lexer->eof(lexer))
            {
                skip(lexer);
            }
            else
            {
                return false;
            }
        }
        else if (lexer->eof(lexer))
        {
            indent_length = 0;
            found_end_of_line = true;
            break;
        }
        else
        {
            break;
        }
    }

    // If we've reached the end of a line, handle indentation and newlines.
    if (found_end_of_line)
    {
        if (scanner->indents.size > 0)
        {
            uint16_t current_indent_length = *array_back(&scanner->indents);

            // Check for indent.
            if (valid_symbols[INDENT] && indent_length > current_indent_length)
            {
                array_push(&scanner->indents, indent_length);
                lexer->result_symbol = INDENT;
                return true;
            }

            // Check if the next token is a string start.
            bool next_tok_is_string_start =
                lexer->lookahead == '\"' || lexer->lookahead == '\'' || lexer->lookahead == '`';

            // Check for dedent. We also trigger a dedent if we shouldn't emit a newline and we're not within brackets.
            if ((valid_symbols[DEDENT] ||
                 (!valid_symbols[NEWLINE] && !(valid_symbols[STRING_START] && next_tok_is_string_start) &&
                  !within_brackets)) &&
                indent_length < current_indent_length && !scanner->inside_raw_string && // dedents are ignored inside of raw strings
                first_comment_indent_length < (int32_t)current_indent_length)
            {
                array_pop(&scanner->indents);
                lexer->result_symbol = DEDENT;
                return true;
            }
        }

        // Check for newline.
        if (valid_symbols[NEWLINE] && !error_recovery_mode)
        {
            lexer->result_symbol = NEWLINE;
            return true;
        }
    }

    // Handle string start.
    if (first_comment_indent_length == -1 && valid_symbols[STRING_START])
    {
        Delimiter delimiter = new_delimiter();

        // Check for string prefixes (r).
        bool has_flags = false;
        if (lexer->lookahead == 'r')
        {
            set_raw(&delimiter);
            has_flags = true;
            advance(lexer);
        }

        // Check for string delimiters.
        if (lexer->lookahead == '`')
        {
            set_end_character(&delimiter, '`');
            advance(lexer);
            lexer->mark_end(lexer);
        }
        else if (lexer->lookahead == '\'')
        {
            set_end_character(&delimiter, '\'');
            advance(lexer);
            lexer->mark_end(lexer);
        }
        else if (lexer->lookahead == '"')
        {
            set_end_character(&delimiter, '"');
            advance(lexer);
            lexer->mark_end(lexer);
            if (lexer->lookahead == '"')
            {
                advance(lexer);
                if (lexer->lookahead == '"')
                {
                    advance(lexer);
                    if (consume_only_whitespace_and_comment_then_newline(lexer))
                    {
                        lexer->mark_end(lexer);
                        set_triple(&delimiter);
                        lookahead_check_ending_delim_whitespace_prefix(lexer, &delimiter);
                        DEBUG("End prefix ws: %d", delimiter.num_whitespace_prefixing_end_delim);
                    }
                    else
                    {
                        return false;
                    }
                }
            }
        }

        // If we found a valid delimiter, push it onto the stack and return STRING_START.
        if (end_character(&delimiter))
        {
            array_push(&scanner->delimiters, delimiter);
            lexer->result_symbol = STRING_START;
            scanner->inside_raw_string = is_raw(&delimiter); // we're inside of a raw string if and only if we didn't set the raw flag
            return true;
        }
    }

    return false;
}

// Serialization function for the external scanner state.
unsigned tree_sitter_rsl_external_scanner_serialize(void *payload, char *buffer)
{
    Scanner *scanner = (Scanner *)payload;
    size_t size = 0;

    // 1) Serialize whether we're currently inside of a raw string.
    buffer[size++] = (char)scanner->inside_raw_string;

    // 2) Serialize the delimiter stack.
    size_t delimiter_count = scanner->delimiters.size;
    if (delimiter_count > UINT8_MAX)
    {
        delimiter_count = UINT8_MAX; // Limit the number of delimiters to avoid overflow.
    }
    buffer[size++] = (char)delimiter_count;

    if (delimiter_count > 0)
    {
        // Each Delimiter struct is 2 bytes in size.
        size_t delimiter_size_bytes = delimiter_count * sizeof(Delimiter);
        // Ensure we don't exceed the available buffer space.
        if (size + delimiter_size_bytes > TREE_SITTER_SERIALIZATION_BUFFER_SIZE)
        {
            delimiter_size_bytes = TREE_SITTER_SERIALIZATION_BUFFER_SIZE - size;
        }
        memcpy(&buffer[size], scanner->delimiters.contents, delimiter_size_bytes);
        size += delimiter_size_bytes;
    }

    // 3) Serialize the indent stack.
    //    We start from index 1 because typically the first element is a sentinel (0).
    for (uint32_t i = 1; i < scanner->indents.size && size + 1 < TREE_SITTER_SERIALIZATION_BUFFER_SIZE; i++)
    {
        uint16_t indent_value = *array_get(&scanner->indents, i);
        // Store in little-endian format (low byte, then high byte).
        buffer[size++] = (char)(indent_value & 0xFF);
        // Check we have one more byte of space:
        if (size < TREE_SITTER_SERIALIZATION_BUFFER_SIZE)
        {
            buffer[size++] = (char)((indent_value >> 8) & 0xFF);
        }
        else
        {
            break;
        }
    }

    return (unsigned)size;
}

// Deserialization function for the external scanner state.
void tree_sitter_rsl_external_scanner_deserialize(void *payload, const char *buffer, unsigned length)
{
    DEBUG("Loading (deserializing) state...");
    Scanner *scanner = (Scanner *)payload;

    // Clear out any existing data in these arrays.
    array_delete(&scanner->delimiters);
    array_delete(&scanner->indents);
    // Push a sentinel 0 for indents.
    array_push(&scanner->indents, 0);

    if (length == 0)
    {
        return;
    }

    size_t size = 0;

    // 1) Deserialize whether we're inside a raw string.
    scanner->inside_raw_string = (bool)buffer[size++];
    if (size >= length)
        return;

    // 2) Deserialize the delimiter stack.
    size_t delimiter_count = (uint8_t)buffer[size++];
    if (size >= length)
        return;

    if (delimiter_count > 0)
    {
        // Reserve space for 'delimiter_count' Delimiters.
        array_reserve(&scanner->delimiters, delimiter_count);
        // Set the size of the array to match the number of Delimiters we will read.
        scanner->delimiters.size = delimiter_count;

        size_t delimiter_size_bytes = delimiter_count * sizeof(Delimiter);
        if (size + delimiter_size_bytes > length)
        {
            // If there's not enough data to read them all, read as many as we can.
            delimiter_size_bytes = length - size;
            // Adjust delimiter_count accordingly.
            delimiter_count = delimiter_size_bytes / sizeof(Delimiter);
            scanner->delimiters.size = delimiter_count;
        }

        memcpy(scanner->delimiters.contents, &buffer[size], delimiter_size_bytes);
        size += delimiter_size_bytes;
    }

    // 3) Deserialize the indent stack.
    while ((size + 1) < length)
    {
        uint16_t indent_value =
            (unsigned char)buffer[size] |
            ((unsigned char)buffer[size + 1] << 8);
        array_push(&scanner->indents, indent_value);
        size += 2;
    }
}

// Create a new external scanner instance.
void *tree_sitter_rsl_external_scanner_create()
{
// Assert that the size of Delimiter is the same as the size of char.
// This is important because the delimiter stack is serialized as an array of chars.
#if defined(__STDC_VERSION__) && (__STDC_VERSION__ >= 201112L)
    _Static_assert(sizeof(Delimiter) == sizeof(char) + sizeof(uint8_t), "");
#else
    assert(sizeof(Delimiter) == sizeof(char));
#endif
    Scanner *scanner = calloc(1, sizeof(Scanner));
    array_init(&scanner->indents);
    array_init(&scanner->delimiters);
    tree_sitter_rsl_external_scanner_deserialize(scanner, NULL, 0);
    DEBUG("Created scanner");
    return scanner;
}

// Destroy an external scanner instance.
void tree_sitter_rsl_external_scanner_destroy(void *payload)
{
    Scanner *scanner = (Scanner *)payload;
    array_delete(&scanner->indents);
    array_delete(&scanner->delimiters);
    free(scanner);
}
