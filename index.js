// Namhyeon Go <abuse@catswords.net>
// MIT License
// Contact or report abuse: abuse@catswords.net

const fs = require('fs')
const sh = require('mvdan-sh')
const syntax = sh.syntax

var parser = syntax.NewParser()
var printer = syntax.NewPrinter()

var src = fs.readFileSync('src.sh', 'utf-8')
var f = parser.Parse(src)

// Configuration
var STATIC_MESSAGES = [];
var ASSIGN_VARIABLES = ["HOME"];
var SHELL_OPCODE = [
    "mkdir", "chmod", "date", "showrev", "uname",
    "grep", "netstat", "ps", "tar", "ls",
    "dspcat", "svcs", "find", "cat", "egrep",
    "inetadm", "inetdam", "ifconfig", "named",
    "env", "umask"
];
var MULTILINE_OPCODES = [];

// find all single quoted string values
syntax.Walk(f, function(node) {
    if (syntax.NodeType(node) == "Assign") {
        var name = node.Name.Value;
        if (ASSIGN_VARIABLES.indexOf(name) < 0) {
            ASSIGN_VARIABLES.push(node.Name.Value);
        }
    }

    if (syntax.NodeType(node) == "DblQuoted") {
       var message = node.Parts.length > 0 && typeof node.Parts[0].Value !== "undefined" ? node.Parts[0].Value : '';
       if (STATIC_MESSAGES.indexOf(message) < 0) {
           STATIC_MESSAGES.push(message);
       }
    }

    return true
})

//console.log(ASSIGN_VARIABLES);
//console.log(STATIC_MESSAGES.join(", "));

//
function _indentation(n) {
    var s = '';
    for (var i = 0; i < n; i++) {
        s += '    ';
    }
    return s;
}

// addalashes
function addslashes(s) {
    return s.replace(/\\/g, '\\\\').
        replace(/\u0008/g, '\\b').
        replace(/\t/g, '\\t').
        replace(/\n/g, '\\n').
        replace(/\f/g, '\\f').
        replace(/\r/g, '\\r').
        //replace(/'/g, '\\\'').
        replace(/"/g, '\\"');
}

// format
function transpile_format(s) {
    var w = s.split(' '), c;
    var v = w.reduce(function(a, x) {
        if (x.indexOf('$') == 0 && ASSIGN_VARIABLES.indexOf(x.substring(1)) > -1) {
            a.a1.push('%s');
            a.a2.push(x.substring(1));
        } else if (x.indexOf('$') > -1) {
            a.a1.push(ASSIGN_VARIABLES.reduce(function(b, x) {
                var pos = b.indexOf('$' + x);
                while (pos > -1) {
                    b = b.substring(0, pos) + "%s" + b.substring(pos + ('$' + x).length);
                    a.a2.push(x);
                    pos = b.indexOf('$' + x);
                }
                return b;
            }, x));
        } else {
            a.a1.push(x);
        }
        return a;
    }, {a1: [], a2: []});

    return v.a2.length > 0 ? 'fmt.Sprintf("' + addslashes(v.a1.join(' ')) + '", ' + v.a2.join(', ') + ')' : '"' + addslashes(v.a1.join(' ')) + '"';
}

// transpile
function transpile_line(a, x) {
    var line = x.trim();
    var opcode = line.split(' ')[0];

    // check redirections
    var dst_redir = line.split(' ').reduce(function(a, x) {
        if (x.indexOf(">>") > -1) {
            a = x.substring(2);
        }
        return a;
    }, '');

    // strip a redirection
    if (line.indexOf(" >") > -1) {
        line = line.substring(0, line.indexOf(" >")).trim();
    }

    // strip a redirection
    if (line.indexOf(">>") > -1) {
        line = line.substring(0, line.indexOf(">>")).trim();
    }

    // strip a rediection
    if (line.indexOf("2>") > -1) {
        line = line.substring(0, line.indexOf("2>")).trim();
    }

    // assign
    if (opcode == "echo") {
        var Lpos = line.indexOf('"', 4)
            Rpos = line.indexOf('"', Lpos + 1)
            s = ''
            Spos = -1;

        if (Lpos > -1 && Rpos > -1) {
            s = line.substring(Lpos + 1, Rpos);
            Spos = STATIC_MESSAGES.indexOf(s);
            if (Spos > -1) {
                s = "STATIC_MESSAGES[" + Spos + "]";
            } else {
                s = transpile_format(s);
            }
        } else {
            s = '""';
        }

        a.push(_indentation(MULTILINE_OPCODES.length) + 'redir_append(' + s + ', ' + transpile_format(dst_redir) + ')');
    }

    // shell
    else if (SHELL_OPCODE.indexOf(opcode) > -1) {
        a.push(_indentation(MULTILINE_OPCODES.length) + 'exec_shell(' + transpile_format(line) + ', ' + transpile_format(dst_redir) + ')');
    }

    // shell
    else if (line.length > 0 && line.substring(0, 1) == '(') {
        a.push(_indentation(MULTILINE_OPCODES.length) + 'exec_shell(' + transpile_format(line) + ', ' + transpile_format(dst_redir) + ')');
    }

    // if
    else if (opcode == "if") {
        var Lpos = line.indexOf('[');
        var Rpos = line.indexOf(']', Lpos + 1);
        var condition = '';

        if (Lpos > -1 && Rpos > -1) {
            condition = line.substring(Lpos + 1, Rpos).trim();
        }
        condition = condition.split(' ').reduce(function(a, x) {
            if (x == '=' || x == "-eq") {
                a.push("==");
            } else if (x == "-ne") {
                a.push("!=");
            } else if (x == "-gt") {
                a.push(">");
            } else if (x == "-ge") {
                a.push(">=");
            } else if (x == "-lt") {
                a.push("<");
            } else if (x == "-le") {
                a.push("<=");
            } else if (x.indexOf('$') == 0 && ASSIGN_VARIABLES.indexOf(x.substring(1)) > -1) {
                a.push(x.substring(1));
            } else if (x.indexOf('"') == 0) {
                var Lpos = x.indexOf('"');
                var Rpos = x.indexOf('"', Lpos + 1);
                var s = x.substring(Lpos + 1, Rpos);
                if (s.indexOf('$') == 0 && ASSIGN_VARIABLES.indexOf(s.substring(1)) > -1) {
                    a.push(s.substring(1));
                } else {
                    a.push(x);
                }
            } else {
                a.push(transpile_format(x));
            }
            return a;
        }, []).join(' ');

        a.push(_indentation(MULTILINE_OPCODES.length) + "if " + condition + " {");
        MULTILINE_OPCODES.push(opcode);
    }

    // if->else
    else if (opcode == "else") {
        var lastword = MULTILINE_OPCODES[MULTILINE_OPCODES.length - 1];
        if (lastword == "if") {
            a.push(_indentation(MULTILINE_OPCODES.length - 1) + "} else {");
        } else {
            a.push(_indentation(MULTILINE_OPCODES.length) + line + "    // Syntax error on IF statement. " + MULTILINE_OPCODES.join(','));
        }
    }

/*
    // if->elif
    else if (opcode == "elif") {
        var lastword = MULTILINE_OPCODES[MULTILINE_OPCODES.length - 1];
        if (lastword == "if") {
            a.push("}");
            a.push("{");
        } else {
            a.push(line + "    // Syntax error on IF statement. " + MULTILINE_OPCODES.join(','));
        }
    }
*/

    // (if or elif or else)->fi
    else if (opcode == "fi") {
        var lastword = MULTILINE_OPCODES[MULTILINE_OPCODES.length - 1];
        if (lastword == "if") {
            MULTILINE_OPCODES.pop();
            a.push(_indentation(MULTILINE_OPCODES.length) + "}");
        } else {
            a.push(_indentation(MULTILINE_OPCODES.length) + line + "    // Syntax error on IF statement. " + MULTILINE_OPCODES.join(','));
        }
    }

    // for
    else if (opcode == "for") {
        var Lpos = line.indexOf("for ");
        var Rpos = line.indexOf("in ", Lpos + 4);
        var k = '';
        if (Lpos > -1 && Rpos > -1) {
            k = line.substring(Lpos + 4, Rpos).trim();
            ASSIGN_VARIABLES.push(k);
        }

        var Rpos2 = line.indexOf(";", Rpos + 3);
        var v  = '';
        if (Rpos > -1 && Rpos2 > -1) {
            v = line.substring(Rpos + 3, Rpos2).trim();
            if (v.indexOf("$\(") == 0) {
                v = 'exec_shell(' + transpile_format(v.substring(2, v.length - 1)) + ', "")';
            }
        }

        a.push(_indentation(MULTILINE_OPCODES.length) + 'for _, ' + k + ' := range strings.Split(strings.ReplaceAll(' + v + ', "\\r\\n", "\\n"), "\\n") {');
        MULTILINE_OPCODES.push(opcode);
    }

    // for->done
    else if (opcode == "done") {
        var lastword = MULTILINE_OPCODES[MULTILINE_OPCODES.length - 1];
        if (lastword == "for") {
            MULTILINE_OPCODES.pop();
            a.push(_indentation(MULTILINE_OPCODES.length) + "}");
        } else {
            a.push(_indentation(MULTILINE_OPCODES.length) + "// Syntax error on FOR statement." + MULTILINE_OPCODES.join(','));
        }
    }

    // assign
    else if (line.indexOf('=') > -1) {
        var Lval = line.substring(0, line.indexOf('=')).trim(), Rval = "";
        if (ASSIGN_VARIABLES.indexOf(Lval) > -1) {
            Rval = line.substring(line.indexOf('=') + 1).trim()
            if (Rval.indexOf('$') == 0) {
                Rval = 'exec_shell(' + transpile_format(Rval.substring(2, Rval.length - 1)) + ', "")';
            } else if (Rval.indexOf('"') < 0) {
                Rval = '"' + Rval + '"';
            }

            a.push(_indentation(MULTILINE_OPCODES.length) + [Lval, ":=", Rval].join(' '));
        }
    }

    // not transpiled
    else {
        a.push('// ' + line + '     // not transpiled');
    }

    return a;
}

// print the code back out
//console.log(printer.Print(f)) // echo 'bar'

var headers = [];
headers.push(fs.readFileSync("header.go.tmpl", "utf-8"));
headers.push("");
headers.push("var STATIC_MESSAGES [" + STATIC_MESSAGES.length + "]string");
headers.push("");
headers.push("func main() {");

var variable_lines = [];
for (var i = 0; i < STATIC_MESSAGES.length; i++) {
    variable_lines.push("STATIC_MESSAGES[" + String(i) + "] = " + transpile_format(STATIC_MESSAGES[i]));
}

// split line by line
var printed = printer.Print(f);
fs.writeFileSync('printed.sh', printed, {encoding: 'utf-8'});
var lines = printed.split(/\r?\n/);
var result = headers.concat(variable_lines.concat(lines.reduce(transpile_line, [])).map(function(x) { return '    ' + x; })).join("\r\n") + "\r\n}";

console.log(result);
