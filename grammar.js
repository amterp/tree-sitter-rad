/**
 * @file RSL grammar for tree-sitter
 * @author Alexander Terp <alexander.terp@gmail.com>
 * @license MIT
 */


/// <reference types="tree-sitter-cli/dsl" />
// @ts-check

const PREC = {
  // this resolves a conflict between the usage of ':' in a lambda vs in a
  // typed parameter. In the case of a lambda, we don't allow typed parameters.
  lambda: -2,
  typed_parameter: -1,
  conditional: -1,

  parenthesized_expr: 1,
  parenthesized_list_splat: 1,
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
  call: 22,
};

module.exports = grammar({
  name: 'rsl',

  extras: $ => [
    $.comment,
    /[\s\f\uFEFF\u2060\u200B]|\r?\n/,
  ],

  conflicts: $ => [
    // [$.primary_expr, $.pattern],list
    // [$.primary_expr, $.list_splat_pattern],
    // [$.list, $.list_pattern],
    // [$.named_expr, $.as_pattern],
    // [$.type_alias_stmt, $.primary_expr],
    // [$.match_stmt, $.primary_expr],
  ],

  supertypes: $ => [
    $._simple_stmt,
    $._compound_stmt,
    $.expr,
    // $.primary_expr,
    // $.pattern,
    // $.parameter,
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

  // inline: $ => [
  //   $._simple_stmt,
  //   $._compound_stmt,
  //   $._suite,
  //   $._exprs,
  //   $._left_hand_side,
  //   $.keyword_identifier,
  // ],

  inline: $ => [
    $._rad_if_clause,
  ],

  word: $ => $.identifier,

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
      $._compound_stmt,
    ),

    // Simple stmts

    _simple_stmts: $ => seq(
      $._simple_stmt,
      $._newline,
    ),

    _simple_stmt: $ => choice(
      $.expr_stmt,
      $.assign,
      $.compound_assign,
      $.incr_decr,
      $.del_stmt,
      $.break_stmt,
      $.continue_stmt,
    ),

    expr_stmt: $ => choice(
      $.expr,
    ),

    // Expressions

    expr: $ => choice(
      $.comparison_op,
      $.not_op,
      $.bool_op,
      $.primary_expr,
      $.ternary,
      $.shell_cmd,
    ),

    primary_expr: $ => choice(
      $.binary_op,
      $.var_path,
      $.literal,
      $.unary_op,
      $.call,
      $.list_comprehension,
      // $.dictionary,
      // $.dictionary_comprehension,
      // $.set,
      // $.set_comprehension,
      $.parenthesized_expr,
    ),

    not_op: $ => prec(PREC.not, seq(
      'not',
      field('arg', $.expr),
    )),

    bool_op: $ => choice(
      prec.left(PREC.and, seq(
        field('left', $.expr),
        field('op', 'and'),
        field('right', $.expr),
      )),
      prec.left(PREC.or, seq(
        field('left', $.expr),
        field('op', 'or'),
        field('right', $.expr),
      )),
    ),

    binary_op: $ => {
      const table = [
        [prec.left, '+', PREC.plus],
        [prec.left, '-', PREC.plus],
        [prec.left, '*', PREC.times],
        [prec.left, '/', PREC.times],
        [prec.left, '%', PREC.times],
      ];

      // @ts-ignore
      return choice(...table.map(([fn, op, precedence]) => fn(precedence, seq(
        field('left', $.primary_expr),
        // @ts-ignore
        field('op', op),
        field('right', $.primary_expr),
      ))));
    },

    comparison_op: $ => prec.left(PREC.compare, seq(
      $.primary_expr,
      repeat1(seq(
        field('ops',
          choice(
            '<',
            '<=',
            '==',
            '!=',
            '>=',
            '>',
            'in',
            seq('not', 'in'),
          )),
        $.primary_expr,
      )),
    )),

    unary_op: $ => prec(PREC.unary, seq(
      field('op', $.unary_op_sign),
      field('arg', $.primary_expr),
    )),

    unary_op_sign: $ => choice('+', '-'),

    parenthesized_expr: $ => prec(PREC.parenthesized_expr, seq(
      '(',
      $.expr,
      ')',
    )),

    call: $ => prec(PREC.call, seq(
      // python does primary_expr, probably to allow e.g. (a ? print : debug)(args here)
      field('func', $.identifier),
      field('args', choice(
        $.call_arg_list,
      )),
    )),

    call_arg_list: $ => choice(
      "()", // empty call
      seq("(", sepTrail1($.expr), ")"), // no named args
      seq("(", optional(seq(commaSep1($.expr), ",")), sepTrail1($.call_named_arg), ")"), // mixed
    ),

    call_named_arg: $ => seq(
      field('name', $.identifier),
      '=',
      field('value', $.expr),
    ),

    // Assignment

    assign: $ => seq(
      field('left', $._left_hand_side),
      '=',
      field('right', $._right_hand_side),
    ),

    compound_assign: $ => seq(
      field('left', $._left_hand_side),
      field('op', choice(
        '+=', '-=', '*=', '/=', '%=',
      )),
      field('right', $._right_hand_side),
    ),

    incr_decr: $ => seq(
      field('left', $._left_hand_side),
      field('op', choice('++', '--')),
    ),

    _left_hand_side: $ => commaSep1($.var_path),

    var_path: $ => prec.left(seq(
      field("root", $.identifier),
      field("indexing", repeat($._var_path_lookup)),
    )),

    _var_path_lookup: $ => choice(
      $._indexing,
      seq(".", $.identifier),
    ),

    _indexing: $ => seq(
      '[',
      choice(
        $.expr,
        $.slice,
      ),
      ']',
    ),

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
      "json",
      optional("[]"),
      repeat(seq(
        '.',
        choice(
          $.identifier,
          "*", // wildcard
        ),
        optional("[]"),
      )),
    ),

    del_stmt: $ => seq(
      "del",
      field("paths", sepTrail1($.var_path)),
    ),

    break_stmt: _ => prec.left('break'),
    continue_stmt: _ => prec.left('continue'),

    // Compound stmts

    _compound_stmt: $ => choice(
      $.if_stmt,
      $.for_loop,
      $.rad_block,
      $._defer_or_errdefer_block,
    ),

    if_stmt: $ => seq(
      $._if_clause,
      colonBlock($, $._stmt),
      repeat(field('alternative', $.elif_clause)),
      optional(field('alternative', $.else_clause)),
    ),

    elif_clause: $ => seq(
      'else',
      $._if_clause,
      colonBlock($, $._stmt),
    ),

    else_clause: $ => seq(
      'else',
      colonBlock($, $._stmt),
    ),

    _if_clause: $ => seq("if", field('condition', $.expr)),

    for_loop: $ => seq(
      $._for_in,
      colonBlock($, $._stmt),
    ),

    _for_in: $ => seq(
      'for',
      field('left', commaSep1($.identifier)),
      'in',
      field('right', $.expr),
    ),

    list_comprehension: $ => seq(
      '[',
      field('expr', $.expr),
      $._for_in,
      optional($._if_clause),
      ']',
    ),

    ternary: $ => prec.right(PREC.conditional, seq(
      field('condition', $.expr),
      '?',
      field('true_branch', $.expr),
      ':',
      field('false_branch', $.expr),
    )),

    shell_cmd: $ => choice(
      field("checked", $.checked_shell_cmd),
      field("unsafe", $.unsafe_shell_cmd),
      field("critical", $.critical_shell_cmd),
    ),

    checked_shell_cmd: $ => seq(
      repeat($._shell_non_unsafe_mod),
      '$',
      field("command", $.expr),
      $._newline,
      field("body_type", $.shell_body_type),
      colonBlock($, $._stmt),
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
    ),

    shell_body_type: $ => choice(
      'fail',
      'recover',
    ),

    // Arg Block

    arg_block: $ => seq(
      "args",
      colonBlock($, $._arg_stmts)
    ),

    _arg_stmts: $ => choice(
      field("declaration", $.arg_declaration),
      $._arg_constraint,
    ),

    arg_declaration: $ => seq(
      field("arg_name", $.identifier),
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
      field('op', repeat($.unary_op_sign)),
      field("value", $.int),
    )),
    float_arg: $ => seq(
      field('op', repeat($.unary_op_sign)),
      field("value", choice($.float, $.int)),
    ),

    _arg_constraint: $ => choice(
      field("enum_constraint", $.arg_enum_constraint),
      field("regex_constraint", $.arg_regex_constraint),
    ),

    arg_enum_constraint: $ => seq(
      field("arg_name", $.identifier),
      "enum",
      field("values", $.string_list),
    ),

    arg_regex_constraint: $ => seq(
      field("arg_name", $.identifier),
      "regex",
      field("regex", $.string),
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
      colonBlock($, $._rad_stmt),
    ),

    _request_block: $ => seq(
      field('rad_type', $.request_keyword),
      field("source", $.expr),
      colonBlock($, $._rad_stmt),
    ),

    _display_block: $ => seq(
      field('rad_type', $.display_keyword),
      colonBlock($, $._rad_stmt),
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
      commaSep0($._rad_sort_specifier),
    )),

    _rad_sort_specifier: $ => seq(
      $.identifier,
      optional(choice("asc", "desc")),
    ),

    rad_field_stmt: $ => seq(
      "fields",
      commaSep1($.identifier),
    ),

    rad_field_modifier_stmt: $ => seq(
      commaSep1($.identifier),
      colonBlock($, $._rad_field_modifier),
    ),

    _rad_field_modifier: $ => choice(
      $.rad_field_mod_color,
      $.rad_field_mod_map,
    ),

    rad_field_mod_color: $ => seq(
      "color",
      $.expr, // todo too freeing?
      $.expr,
    ),

    rad_field_mod_map: $ => seq(
      "map",
      $.lambda,
    ),

    rad_if_stmt: $ => seq(
      $._rad_if_clause,
      colonBlock($, $._rad_stmt),
      repeat(field('alternative', $.rad_elif_clause)),
      optional(field('alternative', $.rad_else_clause)),
    ),

    rad_elif_clause: $ => seq(
      'else',
      $._rad_if_clause,
      colonBlock($, $._rad_stmt),
    ),

    rad_else_clause: $ => seq(
      'else',
      colonBlock($, $._rad_stmt),
    ),

    _rad_if_clause: $ => $._if_clause,

    // Defer block

    _defer_or_errdefer_block: $ => choice(
      $.defer_block,
      $.errdefer_block,
    ),

    defer_block: $ => seq(
      "defer",
      colonBlock($, $._stmt),
    ),

    errdefer_block: $ => seq(
      "errdefer",
      colonBlock($, $._stmt),
    ),

    // Generic

    comment: _ => token(seq('//', /.*/)),

    lambda: $ => seq( // todo quite different from Python's
      $.identifier,
      '->',
      $.expr,
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
      seq("[", sepTrail0($.literal), "]",),
    ),

    map: $ => seq("{", sepTrail0($.map_entry), "}"),
    map_entry: $ => seq(
      field('key', $.expr),
      ":",
      field('value', $.expr),
    ),

    string: $ => seq(
      field("start", $.string_start),
      field("contents", repeat(choice($.interpolation, $.string_contents))),
      field("end", $.string_end),
    ),

    string_contents: $ => prec.right(repeat1(
      choice(
        $._escape_seq,
        field("backslash", $._not_escape_seq),
        field("content", $.string_content),
      ))),

    _escape_seq: $ => prec(1, choice(
      field("single_quote", $.esc_single_quote),
      field("double_quote", $.esc_double_quote),
      field("backtick", $.esc_backtick),
      field("newline", $.esc_newline),
      field("tab", $.esc_tab),
      field("backslash", $.esc_backslash),
    )),

    esc_single_quote: _ => token.immediate("\\'"),
    esc_double_quote: _ => token.immediate('\\"'),
    esc_backtick: _ => token.immediate("\\`"),
    esc_newline: _ => token.immediate("\\n"),
    esc_tab: _ => token.immediate("\\t"),
    esc_backslash: _ => token.immediate("\\\\"),

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

    identifier: $ => /[a-zA-Z_][a-zA-Z0-9_]*/,
    float: $ => /\d+\.\d+/,
    bool: $ => choice("true", "false"),
    int: $ => /\d+/,

    literal: $ => choice(
      $.string,
      $.int,
      $.float,
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
