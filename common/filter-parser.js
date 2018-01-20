"use strict";

const parsimmon = require("parsimmon");

// Turn escaped characters into real ones (e.g. "\\n" becomes "\n").
function interpretEscapes(str) {
  let escapes = {
    b: "\b",
    f: "\f",
    n: "\n",
    r: "\r",
    t: "\t"
  };
  return str.replace(/\\(u[0-9a-fA-F]{4}|[^u])/, (_, escape) => {
    let type = escape.charAt(0);
    let hex = escape.slice(1);
    if (type === "u") return String.fromCharCode(parseInt(hex, 16));

    if (escapes.hasOwnProperty(type)) return escapes[type];

    return type;
  });
}

function binaryLeft(operatorsParser, nextParser) {
  return parsimmon.seqMap(
    nextParser,
    parsimmon.seq(operatorsParser, nextParser).many(),
    (first, rest) =>
      rest.reduce((acc, ch) => {
        let [op, another] = ch;
        if (op === acc[0]) return acc.concat([another]);
        if (op === another[0]) return [op, acc].concat(another.slice(1));
        return [op, acc, another];
      }, first)
  );
}

const lang = parsimmon.createLanguage({
  ComparisonOperator: function() {
    return parsimmon
      .alt(
        parsimmon.string(">="),
        parsimmon.string("<>"),
        parsimmon.string("<="),
        parsimmon.string("="),
        parsimmon.string(">"),
        parsimmon.string("<")
      )
      .skip(parsimmon.optWhitespace);
  },
  IsNullOperator: function() {
    return parsimmon
      .alt(
        parsimmon
          .regexp(/is\s+null/i)
          .result("IS NULL")
          .desc("IS NULL"),
        parsimmon
          .regexp(/is\s+not\s+null/i)
          .result("IS NOT NULL")
          .desc("IS NOT NULL")
      )
      .skip(parsimmon.optWhitespace);
  },
  NotOperator: function() {
    return parsimmon
      .regexp(/not/i)
      .result("NOT")
      .skip(parsimmon.optWhitespace)
      .desc("NOT");
  },
  AndOperator: function() {
    return parsimmon
      .regexp(/and/i)
      .result("AND")
      .skip(parsimmon.optWhitespace)
      .desc("AND");
  },
  OrOperator: function() {
    return parsimmon
      .regexp(/or/i)
      .result("OR")
      .skip(parsimmon.optWhitespace)
      .desc("OR");
  },
  Parameter: function(r) {
    return parsimmon
      .alt(
        parsimmon.regexp(/[a-zA-Z0-9_.*]+/),
        r.ValueExpression.wrap(
          parsimmon.string("{").skip(parsimmon.optWhitespace),
          parsimmon.string("}")
        )
      )
      .atLeast(1)
      .map(x => (x.length > 1 ? ["||"].concat(x) : x[0]))
      .skip(parsimmon.optWhitespace)
      .desc("parameter");
  },
  StringValueSql: function() {
    return parsimmon
      .regexp(/'([^']*)'/, 1)
      .atLeast(1)
      .skip(parsimmon.optWhitespace)
      .map(s => s.join("'"))
      .desc("string");
  },
  StringValueJs: function() {
    return parsimmon
      .regexp(/"((?:\\.|.)*?)"/, 1)
      .skip(parsimmon.optWhitespace)
      .map(interpretEscapes)
      .desc("string");
  },
  NumberValue: function() {
    return parsimmon
      .regexp(/-?(0|[1-9][0-9]*)([.][0-9]+)?([eE][+-]?[0-9]+)?/)
      .skip(parsimmon.optWhitespace)
      .map(Number)
      .desc("number");
  },
  FuncValue: function(r) {
    return parsimmon.seqMap(
      parsimmon
        .regexp(/([a-zA-Z0-0_]+)/, 1)
        .skip(parsimmon.optWhitespace)
        .desc("function"),
      r.Value.sepBy(parsimmon.string(",").skip(parsimmon.optWhitespace)).wrap(
        parsimmon.string("(").skip(parsimmon.optWhitespace),
        parsimmon.string(")").skip(parsimmon.optWhitespace)
      ),
      (f, args) => ["FUNC", f.toUpperCase()].concat(args)
    );
  },
  Value: function(r) {
    return parsimmon.alt(
      r.NumberValue,
      r.StringValueSql,
      r.StringValueJs,
      r.FuncValue
    );
  },
  ValueExpression: function(r) {
    return binaryLeft(
      parsimmon.string("||"),
      binaryLeft(
        parsimmon
          .alt(parsimmon.string("+"), parsimmon.string("-"))
          .skip(parsimmon.optWhitespace),
        binaryLeft(
          parsimmon
            .alt(parsimmon.string("*"), parsimmon.string("/"))
            .skip(parsimmon.optWhitespace),
          parsimmon.alt(
            r.Value,
            r.ValueExpression.wrap(
              parsimmon.string("(").skip(parsimmon.optWhitespace),
              parsimmon.string(")").skip(parsimmon.optWhitespace)
            )
          )
        )
      )
    );
  },
  Comparison: function(r) {
    return parsimmon.alt(
      parsimmon.seqMap(r.Parameter, r.IsNullOperator, (p, o) => [o, p]),
      parsimmon.seqMap(
        r.Parameter,
        r.ComparisonOperator,
        r.ValueExpression,
        (p, o, v) => [o, p, v]
      )
    );
  },
  Expression: function(r) {
    function unary(operatorsParser, nextParser) {
      return parsimmon.seq(operatorsParser, nextParser).or(nextParser);
    }

    return binaryLeft(
      r.OrOperator,
      binaryLeft(
        r.AndOperator,
        unary(
          r.NotOperator,
          r.Comparison.or(
            r.Expression.wrap(
              parsimmon.string("("),
              parsimmon.string(")").skip(parsimmon.optWhitespace)
            )
          )
        )
      )
    ).trim(parsimmon.optWhitespace);
  }
});

function parse(filter) {
  return lang.Expression.tryParse(filter);
}

function parseExpression(exp) {
  return lang.ValueExpression.tryParse(exp);
}

function parseParameter(p) {
  return lang.Parameter.tryParse(p);
}

function stringify(filter) {
  function value(v) {
    if (Array.isArray(v))
      if (v[0].toUpperCase() === "FUNC") {
        return `${v[1]}(${v
          .slice(2)
          .map(e => value(e))
          .join(", ")})`;
      } else {
        return v
          .slice(1)
          .map(e => value(e))
          .join(` ${v[0]} `);
      }

    return JSON.stringify(v);
  }

  function expressions(v) {
    return v.map(e => {
      let str = stringify(e);
      if (e[0] === "AND" || e[0] === "OR") return `(${str})`;
      else return str;
    });
  }

  function parameter(v) {
    if (Array.isArray(v) && v[0] === "||")
      return v
        .slice(1)
        .map(x => {
          if (Array.isArray(x)) return `{${value(x)}}`;
          else return x;
        })
        .join("");

    return v;
  }

  const op = filter[0].toUpperCase();

  if (["AND", "OR"].includes(op))
    return expressions(filter.slice(1)).join(` ${op} `);
  else if (op === "NOT") return `NOT ${expressions(filter.slice(1))[0]}`;
  else if ([">=", "<>", "<=", "=", ">", "<"].includes(op))
    return `${parameter(filter[1])} ${op} ${value(filter[2])}`;
  else if (["IS NULL", "IS NOT NULL"].includes(op))
    return `${parameter(filter[1])} ${op}`;
  else throw new Error("Unrecognized operator");
}

function map(filter, callback) {
  let clone;
  for (let i = 1; i < filter.length; ++i)
    if (Array.isArray(filter[i])) {
      let sub = map(filter[i], callback);
      if (sub != null && sub !== filter[i]) {
        clone = clone || filter.slice();
        clone[i] = sub;
      }
    }

  return callback(clone || filter) || clone || filter;
}

function and(filter1, filter2) {
  if (!filter1) return filter2;
  else if (!filter2) return filter1;

  let res = ["AND"];

  if (filter1[0] === "AND") res = res.concat(filter1.slice(1));
  else res.push(filter1);

  if (filter2[0] === "AND") res = res.concat(filter2.slice(1));
  else res.push(filter2);

  return res;
}

function evaluateExpressions(filter, now = Date.now()) {
  return map(filter, exp => {
    if (exp[0] === "FUNC" && exp[1] === "NOW") {
      return now;
    } else if (exp[0] === "*") {
      let v = exp[1];
      for (let i = 2; i < exp.length; ++i) v *= exp[i];
      return v;
    } else if (exp[0] === "/") {
      let v = exp[1];
      for (let i = 2; i < exp.length; ++i) v /= exp[i];
      return v;
    } else if (exp[0] === "+") {
      let v = exp[1];
      for (let i = 2; i < exp.length; ++i) v += exp[i];
      return v;
    } else if (exp[0] === "-") {
      let v = exp[1];
      for (let i = 2; i < exp.length; ++i) v -= exp[i];
      return v;
    } else if (exp[0] === "||") {
      return exp.slice(1).join("");
    }
  });
}

exports.parse = parse;
exports.parseExpression = parseExpression;
exports.parseParameter = parseParameter;
exports.stringify = stringify;
exports.map = map;
exports.and = and;
exports.evaluateExpressions = evaluateExpressions;
