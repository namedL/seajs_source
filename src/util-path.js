/**
 * util-path.js - The utilities for operating path such as id, uri
 */
//匹配文件夹目录(匹配开头除了？#字母之外，以"/"结尾的任意字符串)
var DIRNAME_RE = /[^?#]*\//
//全局匹配/./
var DOT_RE = /\/\.\//g
//匹配 /目录名/../
var DOUBLE_DOT_RE = /\/[^/]+\/\.\.\//
//匹配多个斜杠（不是在: /后面的多个斜杠）
var MULTI_SLASH_RE = /([^:/])\/+\//g

// Extract the directory portion of a path 提取目录的一部分
// dirname("a/b/c.js?t=123#xx/zz") ==> "a/b/"
// ref: http://jsperf.com/regex-vs-split/2
function dirname(path) {
  return path.match(DIRNAME_RE)[0]
}

// Canonicalize a path 规范化转换一个path
// realpath("http://test.com/a//./b/../c") ==> "http://test.com/a/c"
function realpath(path) {
  // /a/b/./c/./d ==> /a/b/c/d
  path = path.replace(DOT_RE, "/")

  /*
    @author wh1100717
    a//b/c ==> a/b/c
    a///b/////c ==> a/b/c
    DOUBLE_DOT_RE matches a/b/c//../d path correctly only if replace // with / first
  */
  path = path.replace(MULTI_SLASH_RE, "$1/")

  // a/b/c/../../d  ==>  a/b/../d  ==>  a/d
  //在全局模式下返回一个匹配的字符串数组
  while (path.match(DOUBLE_DOT_RE)) {
    path = path.replace(DOUBLE_DOT_RE, "/")
  }

  return path
}

// Normalize an id 标准化一个id
// normalize("path/to/a") ==> "path/to/a.js"
// NOTICE: substring is faster than negative slice and RegExp
function normalize(path) {
  var last = path.length - 1
  var lastC = path.charCodeAt(last)

  // If the uri ends with `#`, just return it without '#'
  if (lastC === 35 /* "#" */) {
    return path.substring(0, last)
  }

  return (path.substring(last - 2) === ".js" ||
      path.indexOf("?") > 0 ||
      lastC === 47 /* "/" */) ? path : path + ".js"
}

//不能以"/"和":"开头，并且结尾必须是"/"后面跟着若干字符(数量至少一个)
var PATHS_RE = /^([^/:]+)(\/.+)$/
//匹配变量，匹配{}对象
var VARS_RE = /{([^{]+)}/g
//解析seajs.config({})中的alias配置
function parseAlias(id) {
  var alias = data.alias
  return alias && isString(alias[id]) ? alias[id] : id
}
//根据设置的data.paths转化id
function parsePaths(id) {
  var paths = data.paths
  var m

  if (paths && (m = id.match(PATHS_RE)) && isString(paths[m[1]])) {
    id = paths[m[1]] + m[2]
  }

  return id
}
//根据设置的vars设置id
//vars 有些场景下，模块路径在运行时才能确定，这时可以使用vars变量来配置
function parseVars(id) {
  var vars = data.vars

  if (vars && id.indexOf("{") > -1) {
    id = id.replace(VARS_RE, function(m, key) {
      return isString(vars[key]) ? vars[key] : m
    })
  }

  return id
}
//根据在map中设置的规则转换uri
//配置项map的用法
/*seajs.config({
  map: [
    [ '.js', '-debug.js' ]
  ]
});
define(function(require, exports, module) {

  var a = require('./a');
  //=> 加载的是 path/to/a-debug.js

});*/
function parseMap(uri) {
  var map = data.map
  var ret = uri

  if (map) {
    for (var i = 0, len = map.length; i < len; i++) {
      var rule = map[i]

      ret = isFunction(rule) ?
          (rule(uri) || uri) :
          uri.replace(rule[0], rule[1])

      // Only apply the first matched rule
      if (ret !== uri) break
    }
  }

  return ret
}

//匹配包含":/"或者"//{char}"开头的字符 {char}代表任意一个字符
var ABSOLUTE_RE = /^\/\/.|:\//
//根目录匹配
//ROOT_DIR_RE.exec("http://www.baidu.com/zhidao/answer/") ==>http://www.baidu.com/
var ROOT_DIR_RE = /^.*?\/\/.*?\//

function addBase(id, refUri) {
  var ret
  var first = id.charCodeAt(0) //获取第一个字符的unicode值

  // Absolute
  //是否时绝对路径
  if (ABSOLUTE_RE.test(id)) {
    ret = id
  }
  // Relative  第一个char是"." 判断refuri是否传入
  else if (first === 46 /* "." */) {
    ret = (refUri ? dirname(refUri) : data.cwd) + id
  }
  // Root 第一个char是"/" 根路径
  else if (first === 47 /* "/" */) {
    var m = data.cwd.match(ROOT_DIR_RE)
    ret = m ? m[0] + id.substring(1) : id
  }
  // Top-level
  else {
    ret = data.base + id
  }

  // Add default protocol when uri begins with "//"
  if (ret.indexOf("//") === 0) {
    ret = location.protocol + ret
  }

  return realpath(ret)
}
//通过id来匹配正确的脚本uri地址
function id2Uri(id, refUri) {
  if (!id) return ""

  id = parseAlias(id)
  id = parsePaths(id)
  id = parseAlias(id)
  id = parseVars(id)
  id = parseAlias(id)
  id = normalize(id)
  id = parseAlias(id)

  var uri = addBase(id, refUri)
  uri = parseAlias(uri)
  uri = parseMap(uri)

  return uri
}

// For Developers
//会利用模块系统的内部机制对传入的字符串参数进行路径解析。
seajs.resolve = id2Uri

// Check environment
// 环境检查
var isWebWorker = typeof window === 'undefined' && typeof importScripts !== 'undefined' && isFunction(importScripts)

// Ignore about:xxx and blob:xxx
var IGNORE_LOCATION_RE = /^(about|blob):/
var loaderDir
// Sea.js's full path
var loaderPath
// Location is read-only from web worker, should be ok though
var cwd = (!location.href || IGNORE_LOCATION_RE.test(location.href)) ? '' : dirname(location.href)

if (isWebWorker) {
  // Web worker doesn't create DOM object when loading scripts
  // Get sea.js's path by stack trace.
  var stack
  try {
    var up = new Error()
    throw up
  } catch (e) {
    // IE won't set Error.stack until thrown
    stack = e.stack.split('\n')
  }
  // First line is 'Error'
  stack.shift()

  var m
  // Try match `url:row:col` from stack trace line. Known formats:
  // Chrome:  '    at http://localhost:8000/script/sea-worker-debug.js:294:25'
  // FireFox: '@http://localhost:8000/script/sea-worker-debug.js:1082:1'
  // IE11:    '   at Anonymous function (http://localhost:8000/script/sea-worker-debug.js:295:5)'
  // Don't care about older browsers since web worker is an HTML5 feature
  var TRACE_RE = /.*?((?:http|https|file)(?::\/{2}[\w]+)(?:[\/|\.]?)(?:[^\s"]*)).*?/i
  // Try match `url` (Note: in IE there will be a tailing ')')
  var URL_RE = /(.*?):\d+:\d+\)?$/
  // Find url of from stack trace.
  // Cannot simply read the first one because sometimes we will get:
  // Error
  //  at Error (native) <- Here's your problem
  //  at http://localhost:8000/_site/dist/sea.js:2:4334 <- What we want
  //  at http://localhost:8000/_site/dist/sea.js:2:8386
  //  at http://localhost:8000/_site/tests/specs/web-worker/worker.js:3:1
  while (stack.length > 0) {
    var top = stack.shift()
    m = TRACE_RE.exec(top)
    if (m != null) {
      break
    }
  }
  var url
  if (m != null) {
    // Remove line number and column number
    // No need to check, can't be wrong at this point
    var url = URL_RE.exec(m[1])[1]
  }
  // Set
  loaderPath = url
  // Set loaderDir
  loaderDir = dirname(url || cwd)
  // This happens with inline worker.
  // When entrance script's location.href is a blob url,
  // cwd will not be available.
  // Fall back to loaderDir.
  if (cwd === '') {
    cwd = loaderDir
  }
}
else {
  // 读取seajs的js标签，并且配置loaderDir参数
  var doc = document
  var scripts = doc.scripts

  // Recommend to add `seajsnode` id for the `sea.js` script element
  // 建议对sea.js这个script标签元素添加seajsnode这个id
  var loaderScript = doc.getElementById("seajsnode") ||
    scripts[scripts.length - 1]

  function getScriptAbsoluteSrc(node) {
    return node.hasAttribute ? // non-IE6/7
      node.src :
      // see http://msdn.microsoft.com/en-us/library/ms536429(VS.85).aspx
      node.getAttribute("src", 4)
  }
  loaderPath = getScriptAbsoluteSrc(loaderScript)
  // When `sea.js` is inline, set loaderDir to current working directory
  // 读取到seajs的文件路径，设置loaderDir为当前的工作目录
  loaderDir = dirname(loaderPath || cwd)
}
