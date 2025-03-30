/**
 * @file RSL grammar for tree-sitter
 * @author Alexander Terp <alexander.terp@gmail.com>
 * @license MIT
 */


/// <reference types="tree-sitter-cli/dsl" />
// @ts-check

const PREC = {
  ternary: -1,

  parenthesized_expr: 1,
  or: 10,
  and: 11,
  not: 12,
  compare: 13,
  bitwise_or: 14,
  bitwise_and: 15,
  xor: 16,
  shift: 17,
  plus: 18,
  times: 19,
  unary: 20,
  power: 21,
  var_path: 22,
  indexing: 23,
  call: 24,
  incr_decr: 25,
};

const identifierRegex = /[a-zA-Z_][a-zA-Z0-9_]*/;

module.exports = grammar({
  name: 'rsl',

  extras: $ => [
    $.comment,
    /[\s\t\f\uFEFF\u2060\u200B]/,
  ],

  externals: $ => [
    $._newline,
    $._indent,
    $._dedent,
    $.string_start,
    $.string_content,
    $.string_end,

    // Mark comments as external tokens so that the external scanner is always
    // invoked, even if no external token is expected. This allows for better
    // error recovery, because the external scanner can maintain the overall
    // structure by returning dedent tokens whenever a dedent occurs, even
    // if no dedent is expected.
    $.comment,

    // Allow the external scanner to check for the validity of closing brackets
    // so that it can avoid returning dedent tokens between brackets.
    ']',
    ')',
    '}',
  ],

  word: $ => $.identifierRegex,

  rules: {
    source_file: $ => seq(
      optional($.shebang),
      optional($.file_header),
      optional($.arg_block),
      repeat($._stmt),
    ),

    shebang: $ => /#!.*/,

    file_header: $ => seq(
      $._file_header_line,
      optional(field("contents", $.file_header_contents)),
      $._file_header_line,
    ),

    file_header_contents: $ => repeat1(seq(
      optional(/[^\r\n]+/),
      /\r?\n/
    )),

    _file_header_line: $ => seq("---", /\r?\n/),

    _stmt: $ => choice(
      $._simple_stmts,
      $._complex_stmt,
    ),

    // Simple stmts

    _simple_stmts: $ => seq(
      $._simple_stmt,
      $._newline,
    ),

    _simple_stmt: $ => choice(
      $.expr,
      $.assign,
      $.compound_assign,
      $.shell_stmt,
      $.incr_decr,
      $.del_stmt,
      $.break_stmt,
      $.continue_stmt,
    ),

    // Expressions

    expr: $ => $.ternary_expr,

    ternary_expr: $ => choice(
      // Ternary operator (lowest precedence; right associative)
      prec.right(PREC.ternary, seq(
        field('condition', $.or_expr),
        '?',
        field('true_branch', $.expr),
        ':',
        field('false_branch', $.ternary_expr)
      )),
      field("delegate", $.or_expr),
    ),

    or_expr: $ => choice(
      prec.left(PREC.or, seq(
        field('left', $.or_expr),
        field('op', 'or'),
        field('right', $.and_expr)
      )),
      field("delegate", $.and_expr),
    ),

    and_expr: $ => choice(
      prec.left(PREC.and, seq(
        field('left', $.and_expr),
        field('op', 'and'),
        field('right', $.compare_expr)
      )),
      field("delegate", $.compare_expr),
    ),

    compare_expr: $ => choice(
      prec.left(PREC.compare, seq(
        field('left', $.compare_expr),
        field('op', choice('<', '<=', '==', '!=', '>=', '>', 'in', $.not_in)),
        field('right', $.add_expr)
      )),
      field("delegate", $.add_expr),
    ),

    not_in: $ => seq('not', 'in'),

    add_expr: $ => choice(
      prec.left(PREC.plus, seq(
        field('left', $.add_expr),
        field('op', $._unary_op_sign),
        field('right', $.mult_expr)
      )),
      field("delegate", $.mult_expr),
    ),

    mult_expr: $ => choice(
      prec.left(PREC.times, seq(
        field('left', $.mult_expr),
        field('op', choice('*', '/', '%')),
        field('right', $.unary_expr)
      )),
      field("delegate", $.unary_expr),
    ),

    unary_expr: $ => choice(
      prec(PREC.unary, seq(
        field('op', choice($._unary_op_sign, 'not')),
        field('arg', $.unary_expr)
      )),
      field("delegate", $._postfix_expr),
    ),

    _postfix_expr: $ => choice(
      $.indexed_expr,
      $.var_path,
    ),

    indexed_expr: $ => prec.left(PREC.call, seq(
      field("root", $.primary_expr),
      repeat($._indexing)
    )),

    primary_expr: $ => choice(
      $.literal,
      $.list_comprehension,
      $.parenthesized_expr,
      $.call,
    ),

    parenthesized_expr: $ => prec(PREC.parenthesized_expr, seq(
      '(',
      field("expr", $.expr),
      ')',
    )),

    call: $ => prec.right(PREC.call, seq(field("func", $._identifier), $._call_arg_list)),

    _call_arg_list: $ => choice(
      "()", // empty call
      seq("(", sepTrail1(field("arg", $.expr)), ")"), // no named args
      seq("(", optional(seq(commaSep1(field("arg", $.expr)), ",")), sepTrail1(field("named_arg", $.call_named_arg)), ")"), // mixed
    ),

    call_named_arg: $ => seq(
      field('name', $._identifier),
      '=',
      field('value', $.expr),
    ),

    _unary_op_sign: $ => choice('+', '-'),

    // Assignment

    assign: $ => seq(
      $._left_hand_side,
      '=',
      commaSep1(field("right", $._right_hand_side)),
    ),

    compound_assign: $ => seq(
      $._left_hand_side,
      field('op', choice(
        '+=', '-=', '*=', '/=', '%=',
      )),
      field('right', $._right_hand_side),
    ),

    incr_decr: $ => prec(PREC.incr_decr, seq(
      field('left', alias($.incr_decr_left, "var_path")),
      field('op', choice('++', '--')),
      // token.immediate(choice("+", "-")),
    )),

    _left_hand_side: $ => commaSep1(field("left", $.var_path)),

    // todo rename to identifier_path?
    var_path: $ => prec.left(PREC.var_path, seq(
      field("root", $._identifier),
      repeat($._indexing),
    )),

    // expected to look like var_path
    incr_decr_left: $ => prec.left(PREC.incr_decr, seq(
      field("root", $._identifier),
      repeat($._indexing),
    )),

    _indexing: $ => prec(PREC.indexing, choice(
      seq(
        '[',
        field('indexing', choice(
          $.expr,
          $.slice,
        )),
        ']'
      ),
      seq('.', field("indexing", choice($._identifier, $.call))),
    )),

    slice: $ => seq(
      optional(field("start", $.expr)),
      ':',
      optional(field("end", $.expr)),
    ),

    _right_hand_side: $ => choice(
      $.expr,
      $.json_path,
    ),

    json_path: $ => seq(
      field("segment", $.json_opener),
      repeat(seq(
        '.',
        optional(field("segment", $.json_segment)),
      )),
    ),

    json_opener: $ => prec.right(seq(
      field("key", "json"),
      repeat(field("index", $.json_path_indexer)),
    )),

    json_segment: $ => prec.right(seq(
      field("key", choice($._identifier, "*")),
      repeat(field("index", $.json_path_indexer)),
    )),

    json_path_indexer: $ => seq("[", optional(field("expr", $.expr)), "]"),

    del_stmt: $ => prec.right(seq(
      "del",
      sepTrail1(field("right", $.var_path)),
    )),

    break_stmt: _ => prec.left('break'),
    continue_stmt: _ => prec.left('continue'),

    // Complex stmts

    _complex_stmt: $ => choice(
      $.if_stmt,
      $.for_loop,
      $.while_loop,
      $.rad_block,
      $.defer_block,
      $.switch_stmt,
    ),

    if_stmt: $ => seq(
      field("alt", $.if_alt),
      repeat(seq("else", field("alt", $.if_alt))),
      optional(seq("else", field("alt", $.else_alt))),
    ),

    if_alt: $ => seq(
      $._if_clause,
      colonBlockField($, $._stmt, "stmt"),
    ),

    _if_clause: $ => seq("if", field('condition', $.expr)),

    else_alt: $ => colonBlockField($, $._stmt, "stmt"),

    for_loop: $ => seq(
      $._for_in,
      colonBlockField($, $._stmt, "stmt"),
    ),

    while_loop: $ => seq(
      "while",
      optional(field("condition", $.expr)),
      colonBlockField($, $._stmt, "stmt"),
    ),

    _for_in: $ => seq(
      'for',
      field("lefts", $.for_lefts),
      'in',
      field('right', $.expr),
    ),

    for_lefts: $ => commaSep1(field('left', $._identifier)),

    list_comprehension: $ => seq(
      '[',
      field('expr', $.expr),
      $._for_in,
      optional($._if_clause),
      ']',
    ),

    switch_stmt: $ => seq(
      optional(seq($._left_hand_side, "=")),
      'switch',
      field("discriminant", $.expr),
      ":",
      $._newline,
      $._indent,
      field("case", repeat($.switch_case)),
      optional(field("default", $.switch_default)),
      $._dedent,
    ),

    switch_case: $ => seq(
      "case",
      commaSep1(field("case_key", $.expr)),
      $._switch_case_value_alt,
      $._newline,
    ),

    _switch_case_value_alt: $ => field("alt", choice(
      $.switch_case_expr,
      $.switch_case_block,
    )),

    switch_case_expr: $ => seq(
      "->",
      commaSep1(field("value", $._right_hand_side)),
    ),

    switch_case_block: $ => seq(
      ":",
      $._newline,
      $._indent,
      field("stmt", repeat($._stmt)),
      optional(seq(field("yield_stmt", $.yield_stmt), $._newline)),
      $._dedent,
    ),

    yield_stmt: $ => seq(
      "yield",
      commaSep1(field("value", $._right_hand_side)),
    ),

    switch_default: $ => seq(
      "default",
      $._switch_case_value_alt,
      $._newline,
    ),

    shell_stmt: $ => seq(
      optional(seq($._left_hand_side, "=")),
      field("shell_cmd", choice(
        $.checked_shell_cmd,
        $.unsafe_shell_cmd,
        $.critical_shell_cmd,
      ))),

    checked_shell_cmd: $ => seq(
      repeat($._shell_non_unsafe_mod),
      '$',
      field("command", $.expr),
      $._newline,
      field("response", choice('fail', 'recover')),
      colonBlockField($, $._stmt, "stmt"),
    ),

    unsafe_shell_cmd: $ => seq(
      repeat($._shell_non_unsafe_mod),
      repeat1(field("unsafe_mod", "unsafe")), // required somewhere in there
      repeat($._shell_non_unsafe_mod),
      '$',
      field("command", $.expr),
    ),

    critical_shell_cmd: $ => seq(
      repeat($._shell_non_unsafe_mod),
      '$!',
      field("command", $.expr), // too free? string or identifier?
    ),

    _shell_non_unsafe_mod: $ => choice(
      field("quiet_mod", "quiet"),
      field("confirm_mod", "confirm"),
      // when adding more here, ensure you add an alias in $.call
    ),

    // Arg Block

    arg_block: $ => seq(
      "args",
      colonBlock($, $._arg_stmt)
    ),

    _arg_stmt: $ => choice(
      field("declaration", $.arg_declaration),
      $._arg_constraint,
    ),

    arg_declaration: $ => seq(
      field("arg_name", $._identifier),
      optional(field("rename", $.string)),
      optional(field("shorthand", $.shorthand_flag)),
      $._type_andor_default,
      optional($._arg_comment),
    ),

    _arg_comment: $ => seq(
      /#[ \t]*/,
      field("comment", $.comment_text),
    ),

    comment_text: $ => /.*/,

    shorthand_flag: $ => /[a-zA-Z]/,

    _type_andor_default: $ => choice(
      $._arg_string_default,
      $._arg_int_default,
      $._arg_float_default,
      $._arg_bool_default,
      $._arg_string_list_default,
      $._arg_int_list_default,
      $._arg_float_list_default,
      $._arg_bool_list_default,
    ),

    _arg_string_default: $ => seq(field("type", $.string_type), optional(seq("=", field("default", $.string)))),
    _arg_int_default: $ => seq(field("type", $.int_type), optional(seq("=", field("default", $.int_arg)))),
    _arg_float_default: $ => seq(field("type", $.float_type), optional(seq("=", field("default", $.float_arg)))),
    _arg_bool_default: $ => seq(field("type", $.bool_type), optional(seq("=", field("default", $.bool)))),
    _arg_string_list_default: $ => seq(field("type", $.string_list_type), optional(seq("=", field("default", $.string_list)))),
    _arg_int_list_default: $ => seq(field("type", $.int_list_type), optional(seq("=", field("default", $.int_list)))),
    _arg_float_list_default: $ => seq(field("type", $.float_list_type), optional(seq("=", field("default", $.float_list)))),
    _arg_bool_list_default: $ => seq(field("type", $.bool_list_type), optional(seq("=", field("default", $.bool_list)))),

    int_arg: $ => prec(1, seq(
      field('op', repeat($._unary_op_sign)),
      field("value", $.int),
    )),
    float_arg: $ => seq(
      field('op', repeat($._unary_op_sign)),
      field("value", choice($.float, $.int)),
    ),

    _arg_constraint: $ => choice(
      field("enum_constraint", $.arg_enum_constraint),
      field("regex_constraint", $.arg_regex_constraint),
      field("range_constraint", $.arg_range_constraint),
      field("requires_constraint", $.arg_requires_constraint),
      field("excludes_constraint", $.arg_excludes_constraint),
    ),

    arg_enum_constraint: $ => seq(
      field("arg_name", $._identifier),
      "enum",
      field("values", $.string_list),
    ),

    arg_regex_constraint: $ => seq(
      field("arg_name", $._identifier),
      "regex",
      field("regex", $.string),
    ),

    arg_range_constraint: $ => seq(
      field("arg_name", $._identifier),
      "range",
      seq(
        choice(
          field("opener", "("),
          field("opener", "["),
        ),
        choice(
          $._arg_range_constraint_min_only,
          $._arg_range_constraint_max_only,
          $._arg_range_constraint_min_max,
        ),
        choice(
          field("closer", ")"),
          field("closer", "]"),
        ),
      ),
    ),

    _arg_range_constraint_min_only: $ => seq(
      $._arg_range_constraint_min,
      ",",
    ),

    _arg_range_constraint_max_only: $ => seq(
      ",",
      $._arg_range_constraint_max,
    ),

    _arg_range_constraint_min_max: $ => seq(
      $._arg_range_constraint_min,
      ",",
      $._arg_range_constraint_max,
    ),

    _arg_range_constraint_min: $ => choice(
      field("min", $.int_arg),
      field("min", $.float_arg),
    ),

    _arg_range_constraint_max: $ => choice(
      field("max", $.int_arg),
      field("max", $.float_arg),
    ),

    arg_requires_constraint: $ => seq(
      field("arg_name", $._identifier),
      optional(field("mutually", "mutually")),
      field("requires", "requires"),
      commaSep1(field("required", $._identifier)),
    ),

    arg_excludes_constraint: $ => seq(
      field("arg_name", $._identifier),
      optional(field("mutually", "mutually")),
      field("excludes", "excludes"),
      commaSep1(field("excluded", $._identifier)),
    ),

    // Rad Block

    rad_block: $ => choice(
      $._rad_rad_block,
      $._request_block,
      $._display_block,
    ),

    _rad_rad_block: $ => seq(
      field('rad_type', $.rad_keyword),
      field("source", $.expr),
      colonBlockField($, $._rad_stmt, "stmt"),
    ),

    _request_block: $ => seq(
      field('rad_type', $.request_keyword),
      field("source", $.expr),
      colonBlockField($, $._rad_stmt, "stmt"),
    ),

    _display_block: $ => seq(
      field('rad_type', $.display_keyword),
      colonBlockField($, $._rad_stmt, "stmt"),
    ),

    rad_keyword: $ => "rad",
    request_keyword: $ => "request",
    display_keyword: $ => "display",

    _rad_stmt: $ => choice(
      $.rad_field_stmt,
      $.rad_sort_stmt,
      $.rad_field_modifier_stmt,
      $.rad_if_stmt,
    ),

    rad_sort_stmt: $ => prec.right(seq(
      "sort",
      commaSep0(field("specifier", $.rad_sort_specifier)),
    )),

    rad_sort_specifier: $ => seq(
      token.immediate(/[ \t]+/),
      field("first", $.immediate_identifier),
      optional(
        field("second", choice(
          token.immediate("asc"),
          token.immediate("desc"),
        )),
      ),
    ),

    immediate_identifier: $ => token.immediate(identifierRegex),

    rad_field_stmt: $ => seq(
      "fields",
      commaSep1(field("identifier", $._identifier)),
    ),

    rad_field_modifier_stmt: $ => seq(
      commaSep1(field("identifier", $._identifier)),
      colonBlockField($, $._rad_field_modifier, "mod_stmt"),
    ),

    _rad_field_modifier: $ => choice(
      $.rad_field_mod_color,
      $.rad_field_mod_map,
    ),

    rad_field_mod_color: $ => seq(
      "color",
      field("color", $.expr), // todo too freeing?
      field("regex", $.expr),
    ),

    rad_field_mod_map: $ => seq(
      "map",
      field("lambda", $.lambda),
    ),

    rad_if_stmt: $ => seq(
      field("alt", $.rad_if_alt),
      repeat(seq("else", field("alt", $.rad_if_alt))),
      optional(seq("else", field("alt", $.rad_else_alt))),
    ),

    rad_if_alt: $ => seq(
      $._if_clause,
      colonBlockField($, $._rad_stmt, "stmt"),
    ),

    rad_else_alt: $ => colonBlockField($, $._rad_stmt, "stmt"),

    // Defer block

    defer_block: $ => seq(
      field("keyword", choice("defer", "errdefer")),
      choice(
        colonBlockField($, $._stmt, "stmt"),
        field("stmt", $._simple_stmt),
      ),
    ),

    // Generic

    comment: _ => token(seq('//', /.*/)),

    lambda: $ => seq( // todo quite different from Python's
      field("identifier", $._identifier),
      '->',
      field("expr", $.expr),
    ),

    type: $ => choice(
      $.string_type,
      $.int_type,
      $.float_type,
      $.bool_type,
      $.string_list_type,
      $.int_list_type,
      $.float_list_type,
      $.bool_list_type,
    ),

    string_type: $ => "string",
    int_type: $ => "int",
    float_type: $ => "float",
    bool_type: $ => "bool",
    string_list_type: $ => "string[]",
    int_list_type: $ => "int[]",
    float_list_type: $ => "float[]",
    bool_list_type: $ => "bool[]",

    block: $ => seq(
      repeat($._stmt),
      $._dedent,
    ),

    empty_list: $ => prec(2, seq("[", "]")),

    string_list: $ => seq(
      "[",
      sepTrail0(field("list_entry", $.string)),
      "]",
    ),
    // intended for arg block
    int_list: $ => seq(
      "[",
      sepTrail0(field("list_entry", $.int_arg)),
      "]",
    ),
    // intended for arg block
    float_list: $ => seq(
      "[",
      sepTrail0(field("list_entry", choice($.float_arg, $.int_arg))),
      "]",
    ),
    bool_list: $ => seq(
      "[",
      sepTrail0(field("list_entry", $.bool)),
      "]",
    ),
    list: $ => choice(
      $.empty_list,
      seq("[", sepTrail0(field("list_entry", $.expr)), "]",),
    ),

    map: $ => seq("{", sepTrail0(field("map_entry", $.map_entry)), "}"),
    map_entry: $ => seq(
      field('key', $.expr),
      ":",
      field('value', $.expr),
    ),

    string: $ => seq(
      field("start", $.string_start),
      optional(field("contents", $.string_contents)),
      field("end", $.string_end),
    ),

    string_contents: $ => prec.right(repeat1(
      choice(
        $._escape_seq,
        field("backslash", $._not_escape_seq),
        field("content", $.string_content),
        field("interpolation", $.interpolation),
      ))),

    _escape_seq: $ => prec(1, choice(
      field("single_quote", $.esc_single_quote),
      field("double_quote", $.esc_double_quote),
      field("backtick", $.esc_backtick),
      field("newline", $.esc_newline),
      field("tab", $.esc_tab),
      field("backslash", $.esc_backslash),
      field("open_bracket", $.esc_open_bracket),
    )),

    esc_single_quote: _ => token.immediate("\\'"),
    esc_double_quote: _ => token.immediate('\\"'),
    esc_backtick: _ => token.immediate("\\`"),
    esc_newline: _ => token.immediate("\\n"),
    esc_tab: _ => token.immediate("\\t"),
    esc_backslash: _ => token.immediate("\\\\"),
    esc_open_bracket: _ => token.immediate("\\{"),

    _not_escape_seq: _ => token.immediate('\\'),

    interpolation: $ => seq(
      '{',
      field('expr', $.expr),
      optional(field('format', $.format_specifier)),
      '}',
    ),
    format_specifier: $ => seq(
      ':',
      seq(
        optional(field("alignment", choice("<", ">"))),
        optional(field("padding", $.int)),
        optional(seq('.', field("precision", $.int))),
      ),
    ),

    identifierRegex: _ => identifierRegex,

    _identifier: $ => prec(1, choice( // prec to avoid conflict with aliases
      // if identifier is missing, *identifierRegex* will be the node marked as missing.
      // by aliasing it here, we prevent downstream from needing to worry about identifierRegex,
      // but still let them see when the identifier is missing.
      alias($.identifierRegex, "identifier"),
      // need the following aliases, otherwise tree sitter eagerly parses them out
      // as keywords, causing ERROR nodes in the tree
      alias("confirm", "identifier"),
      alias("unsafe", "identifier"),
      alias("quiet", "identifier"),
    )),

    int: _ => /\d(_?\d+)*/,
    float: _ => /\d(_?\d+)*((\.\d(_?\d+)*([eE][+-]?\d(_?\d+)*)?)|([eE][+-]?\d(_?\d+)*))/,
    bool: _ => choice("true", "false"),

    literal: $ => choice(
      $.string,
      $.float,
      $.int,
      $.bool,
      $.list,
      $.map,
    ),
  },
});

module.exports.PREC = PREC;

/**
 * Creates a rule to match zero or more of the rules separated by a comma
 *
 * @param {RuleOrLiteral} rule
 *
 * @returns {ChoiceRule}
 */
function commaSep0(rule) {
  return sep0(rule, ',');
}

/**
 * Creates a rule to match zero or more occurrences of `rule` separated by `sep`, no trail.
 *
 * @param {RuleOrLiteral} rule
 *
 * @param {RuleOrLiteral} separator
 *
 * @returns {ChoiceRule}
 */
function sep0(rule, separator) {
  return optional(sep1(rule, separator));
}

/**
 * Creates a rule to match one or more of the rules separated by a comma
 *
 * @param {RuleOrLiteral} rule
 *
 * @returns {SeqRule}
 */
function commaSep1(rule) {
  return sep1(rule, ',');
}

/**
 * Creates a rule to match one or more occurrences of `rule` separated by `sep`, no trail.
 *
 * @param {RuleOrLiteral} rule
 *
 * @param {RuleOrLiteral} separator
 *
 * @returns {SeqRule}
 */
function sep1(rule, separator) {
  return seq(rule, repeat(seq(separator, rule)));
}

/**
 * Creates a rule to match zero or more occurrences of a rule, allowing for trailing commas.
 *
 * @param {RuleOrLiteral} rule
 *
 * @returns {ChoiceRule}
 */
function sepTrail0(rule) {
  return optional(sepTrail1(rule));
}

/**
 * Creates a rule to match one or more occurrences of a rule, allowing for trailing commas.
 *
 * @param {RuleOrLiteral} rule
 *
 * @returns {SeqRule}
 */
function sepTrail1(rule) {
  return seq(rule, repeat(seq(',', rule)), optional(','));
}

/**
 * Creates a rule to match repeated occurrences of a rule as a body, starting with a colon,
 * handling indents.
 *
 * @param {RuleOrLiteral} rule
 *
 * @returns {SeqRule}
 */
function colonBlock($, rule) {
  return seq(
    ":",
    $._newline,
    $._indent,
    repeat(rule),
    $._dedent
  );
}

/**
 * Creates a rule to match repeated occurrences of a rule as a body, starting with a colon,
 * handling indents.
 *
 * @param {RuleOrLiteral} rule
 *
 * @returns {SeqRule}
 */
function colonBlockField($, rule, fieldName) {
  return seq(
    ":",
    $._newline,
    $._indent,
    field(fieldName, repeat(rule)),
    $._dedent
  );
}
