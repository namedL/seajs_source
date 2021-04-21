/**
 * config.js - The configuration for the loader
 */

// The root path to use for id2uri parsing
// 根路径
data.base = loaderDir

// The loader directory
// 加载的文件夹
data.dir = loaderDir

// The loader's full path
// 加载的全路径
data.loader = loaderPath

// The current working directory
// 当前工作目录
data.cwd = cwd

// The charset for requesting files
//编码格式
data.charset = "utf-8"

// @Retention(RetentionPolicy.SOURCE)
// The CORS options, Don't set CORS on default.
//
//data.crossorigin = undefined

// data.alias - An object containing shorthands of module id
// data.paths - An object containing path shorthands in module id
// data.vars - The {xxx} variables in module id
// data.map - An array containing rules to map module uri
// data.debug - Debug mode. The default value is false

seajs.config = function(configData) {

  for (var key in configData) {
    //外部传入的值
    var curr = configData[key]
    //内部值
    var prev = data[key]

    // Merge object config such as alias, vars
    // 若内部值为对象，把外部值合并到内部值
    if (prev && isObject(prev)) {
      for (var k in curr) {
        prev[k] = curr[k]
      }
    }
    else {
      // Concat array config such as map
      //内部值为数组，
      if (isArray(prev)) {
        curr = prev.concat(curr)
      }
      // Make sure that `data.base` is an absolute path
      else if (key === "base") {
        // Make sure end with "/"
        if (curr.slice(-1) !== "/") {
          curr += "/"
        }
        curr = addBase(curr)
      }

      // Set config
      data[key] = curr
    }
  }

  emit("config", configData)
  return seajs
}
