#include "tree_sitter/array.h"
#include "tree_sitter/parser.h"

#include <assert.h>
#include <stdint.h>
#include <stdio.h>
#include <string.h>

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
    EXCEPT,
};

// Flags to describe string delimiters (single quote, double quote, etc.) and
// string modifiers (raw, triple, bytes).
typedef enum
{
    SingleQuote = 1 << 0,
    DoubleQuote = 1 << 1,
    BackQuote = 1 << 2,
    Raw = 1 << 3,
    Triple = 1 << 4,
} Flags;

// Structure to represent a string delimiter.
typedef struct
{
    char flags; // Stores the delimiter type and modifiers using the Flags enum.
} Delimiter;

// Helper functions to create and manipulate delimiters.
static inline Delimiter new_delimiter() { return (Delimiter){0}; }

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
    if (delimiter->flags & BackQuote)
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
        delimiter->flags |= BackQuote;
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
    bool inside_raw_string;      // Tracks if a raw string is currently being processed. (This was confusing and had me puzzled for a while.)
} Scanner;

// Helper functions to advance the lexer.
static inline void advance(TSLexer *lexer) { lexer->advance(lexer, false); }

static inline void skip(TSLexer *lexer) { lexer->advance(lexer, true); }

static bool consume_only_whitespace_and_comment_then_newline(TSLexer *lexer)
{
    for (;;)
    {
        switch (lexer->lookahead)
        {
        // If we hit newline or EOF, we’re good
        case '\r':
            skip(lexer);
        case '\n':
            // in case we hit above \r and it's followed by \n
            if (lexer->lookahead == '\n')
            {
                skip(lexer);
            }
        case 0:
            return true;

        // If it’s normal whitespace, consume it and keep going
        case ' ':
        case '\t':
            skip(lexer);
            break;

        case '/':
            skip(lexer);
            if (lexer->lookahead == '/')
            {
                skip(lexer);
                while (lexer->lookahead != '\r' && lexer->lookahead != '\n' && lexer->lookahead != 0)
                {
                    skip(lexer);
                }
                if (lexer->lookahead == '\r')
                {
                    skip(lexer);
                }
                if (lexer->lookahead == '\n')
                {
                    skip(lexer);
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

// The core external scanner function.
bool tree_sitter_rsl_external_scanner_scan(void *payload, TSLexer *lexer, const bool *valid_symbols)
{
    Scanner *scanner = (Scanner *)payload;

    // Special handling for error recovery mode and when within brackets.
    bool error_recovery_mode = valid_symbols[STRING_CONTENT] && valid_symbols[INDENT];
    bool within_brackets = valid_symbols[CLOSE_BRACE] || valid_symbols[CLOSE_PAREN] || valid_symbols[CLOSE_BRACKET];

    // Handle string content.
    if (valid_symbols[STRING_CONTENT] && scanner->delimiters.size > 0 && !error_recovery_mode)
    {
        Delimiter *delimiter = array_back(&scanner->delimiters);
        int32_t end_char = end_character(delimiter);
        bool has_content = false; // Keep track of whether we've encountered any content.
        while (lexer->lookahead)
        {
            // Check for escape interpolation start within the string.
            if ((lexer->lookahead == '{' || lexer->lookahead == '}') && !is_raw(delimiter))
            {
                lexer->mark_end(lexer);
                lexer->result_symbol = STRING_CONTENT;
                return has_content;
            }

            // Handle escape sequences.
            if (lexer->lookahead == '\\')
            {
                if (is_raw(delimiter))
                {
                    // In raw strings, backslashes are treated literally, except when escaping quotes or newlines.
                    advance(lexer);
                    if (lexer->lookahead == end_character(delimiter) || lexer->lookahead == '\\')
                    {
                        advance(lexer);
                    }
                    if (lexer->lookahead == '\r')
                    {
                        advance(lexer);
                        if (lexer->lookahead == '\n')
                        {
                            advance(lexer);
                        }
                    }
                    else if (lexer->lookahead == '\n')
                    {
                        advance(lexer);
                    }
                    continue;
                }
                else
                {
                    // In regular strings, backslash indicates an escape sequence.
                    lexer->mark_end(lexer);
                    lexer->result_symbol = STRING_CONTENT;
                    return has_content;
                }
            }
            else if (lexer->lookahead == end_char)
            {
                // Handle string end.
                if (is_triple(delimiter))
                {
                    // For triple-quoted strings, we need three consecutive delimiters to end.
                    lexer->mark_end(lexer);
                    advance(lexer);
                    if (lexer->lookahead == end_char)
                    {
                        advance(lexer);
                        if (lexer->lookahead == end_char)
                        {
                            if (has_content)
                            {
                                lexer->result_symbol = STRING_CONTENT;
                            }
                            else
                            {
                                advance(lexer);
                                lexer->mark_end(lexer);
                                array_pop(&scanner->delimiters);
                                lexer->result_symbol = STRING_END;
                                scanner->inside_raw_string = false;
                            }
                            return true;
                        }
                        lexer->mark_end(lexer);
                        lexer->result_symbol = STRING_CONTENT;
                        return true;
                    }
                    lexer->mark_end(lexer);
                    lexer->result_symbol = STRING_CONTENT;
                    return true;
                }
                // For single-quoted strings, a single delimiter ends the string.
                if (has_content)
                {
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
            else if (lexer->lookahead == '\n' && has_content && !is_triple(delimiter))
            {
                // Newlines are not allowed in single-quoted strings.
                return false;
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
        else if (lexer->lookahead == '#' && (valid_symbols[INDENT] || valid_symbols[DEDENT] ||
                                             valid_symbols[NEWLINE] || valid_symbols[EXCEPT]))
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
                    if (consume_only_whitespace_and_comment_then_newline(lexer)) {
                        lexer->mark_end(lexer);
                        set_triple(&delimiter);
                    } else {
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
            scanner->inside_raw_string = !is_raw(&delimiter); // we're inside of a raw string if and only if we didn't set the raw flag
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

    // Serialize whether we're currently inside of a raw string.
    buffer[size++] = (char)scanner->inside_raw_string;

    // Serialize the delimiter stack.
    size_t delimiter_count = scanner->delimiters.size;
    if (delimiter_count > UINT8_MAX)
    {
        delimiter_count = UINT8_MAX; // Limit the number of delimiters to avoid overflow.
    }
    buffer[size++] = (char)delimiter_count;

    if (delimiter_count > 0)
    {
        memcpy(&buffer[size], scanner->delimiters.contents, delimiter_count);
    }
    size += delimiter_count;

    // Serialize the indent stack.
    uint32_t iter = 1;
    for (; iter < scanner->indents.size && size < TREE_SITTER_SERIALIZATION_BUFFER_SIZE; ++iter)
    {
        uint16_t indent_value = *array_get(&scanner->indents, iter);
        buffer[size++] = (char)(indent_value & 0xFF);
        buffer[size++] = (char)((indent_value >> 8) & 0xFF);
    }

    return size;
}

// Deserialization function for the external scanner state.
void tree_sitter_rsl_external_scanner_deserialize(void *payload, const char *buffer, unsigned length)
{
    Scanner *scanner = (Scanner *)payload;

    array_delete(&scanner->delimiters);
    array_delete(&scanner->indents);
    array_push(&scanner->indents, 0);

    if (length > 0)
    {
        size_t size = 0;

        // Deserialize whether we're inside a raw string.
        scanner->inside_raw_string = (bool)buffer[size++];

        // Deserialize the delimiter stack.
        size_t delimiter_count = (uint8_t)buffer[size++];
        if (delimiter_count > 0)
        {
            array_reserve(&scanner->delimiters, delimiter_count);
            scanner->delimiters.size = delimiter_count;
            memcpy(scanner->delimiters.contents, &buffer[size], delimiter_count);
            size += delimiter_count;
        }

        // Deserialize the indent stack.
        for (; size + 1 < length; size += 2)
        {
            uint16_t indent_value = (unsigned char)buffer[size] | ((unsigned char)buffer[size + 1] << 8);
            array_push(&scanner->indents, indent_value);
        }
    }
}

// Create a new external scanner instance.
void *tree_sitter_rsl_external_scanner_create()
{
// Assert that the size of Delimiter is the same as the size of char.
// This is important because the delimiter stack is serialized as an array of chars.
#if defined(__STDC_VERSION__) && (__STDC_VERSION__ >= 201112L)
    _Static_assert(sizeof(Delimiter) == sizeof(char), "");
#else
    assert(sizeof(Delimiter) == sizeof(char));
#endif
    Scanner *scanner = calloc(1, sizeof(Scanner));
    array_init(&scanner->indents);
    array_init(&scanner->delimiters);
    tree_sitter_rsl_external_scanner_deserialize(scanner, NULL, 0);
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
