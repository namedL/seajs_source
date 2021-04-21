/**
 * module.js - The core of module loader
 */

var cachedMods = seajs.cache = {}
var anonymousMeta  //匿名元数据

var fetchingList = {} //正在拉取列表
var fetchedList = {} //已拉取完成的列表
var callbackList = {} //回调列表

var STATUS = Module.STATUS = {
  // 1 - The `module.uri` is being fetched
  // 开始拉取模块
  // seajs.use -> 启动模块系统，加载一个或多个模块,此时状态为0，模块初始化完后，执行mod.load
  FETCHING: 1,
  // 2 - The meta data has been saved to cachedMods
  // 模块加载完成，并且保存模块数据(cachedMods)
  // 开始加载整个流程： Module.use -> FETCHING到SAVED
  SAVED: 2,
  // 3 - The `module.dependencies` are being loaded
  // 开始加载此模块的依赖文件
  // 模块开始加载： Module.prototype.load  -> SAVED到LOADING
  LOADING: 3,
  // 4 - The module are ready to execute
  // 依赖模块加载完成
  // 依赖模块加载完成时触发： Module.prototype.onload  -> LOADING到LOADED
  LOADED: 4,
  // 5 - The module is being executed
  // 当前模块正在执行中
  // 加载过程结束，开始执行模块： Module.prototype.exec -> EXECUTING到EXECUTED
  EXECUTING: 5,
  // 6 - The `module.exports` is available
  // 模块执行完成
  EXECUTED: 6,
  // 7 - 404
  ERROR: 7
}

/**
 * 模块
 * @param {*} uri 模块标识，标识唯一性使用的
 * @param {*} deps 此uri下对应的模块，这是一个数组
 */
function Module(uri, deps) {
  this.uri = uri
  //存放外部传入的模块
  this.dependencies = deps || []
  //对外部传入的模块处理做引用存储，最后存储一个模块
  //在load方法中启动存储
  this.deps = {} // Ref the dependence modules  引用的依赖模块
  this.status = 0

  this._entry = []
}

// Resolve module.dependencies
// 处理模块的依赖
Module.prototype.resolve = function() {
  var mod = this
  var ids = mod.dependencies
  var uris = []

  for (var i = 0, len = ids.length; i < len; i++) {
    uris[i] = Module.resolve(ids[i], mod.uri)
  }
  return uris
}

//模块传递
Module.prototype.pass = function() {
  var mod = this

  var len = mod.dependencies.length
  // 遍历入口模块的_entry属性，这个属性一般只有一个值，就是它本身
  // 具体可以回去看use方法 -> mod._entry.push(mod)
  for (var i = 0; i < mod._entry.length; i++) {
    var entry = mod._entry[i] // 获取入口模块
    var count = 0 //标识未处理依赖个数
    for (var j = 0; j < len; j++) {
      var m = mod.deps[mod.dependencies[j]]
      // If the module is unload and unused in the entry, pass entry to it
       // 如果模块未加载，并且在entry中未使用，将entry传递给依赖
      if (m.status < STATUS.LOADED && !entry.history.hasOwnProperty(m.uri)) {
        entry.history[m.uri] = true // 在入口模块标识曾经加载过该依赖模块
        count++
        m._entry.push(entry) // 将入口模块存入依赖模块的_entry属性
        if(m.status === STATUS.LOADING) {
          m.pass()
        }
      }
    }
    // If has passed the entry to it's dependencies, modify the entry's count and del it in the module
    // 如果已将条目传递给它的依赖项，则修改条目的计数并在模块中删除它
    // 如果未加载的依赖模块大于0
    if (count > 0) {
      // 这里`count - 1`的原因也可以回去看use方法 -> mod.remain = 1
      // remain的初始值就是1，表示默认就会有一个未加载的模块，所有需要减1
      entry.remain += count - 1
      // 如果有未加载的依赖项，则移除掉入口模块的entry
      mod._entry.shift()
      i--
    }
  }
}

// Load module.dependencies and fire onload when all done
// 加载module.dependencies(所有依赖模块)并在所有操作完成后触发onload
Module.prototype.load = function() {
  var mod = this

  // If the module is being loaded, just wait it onload call
  //如果模块已经加载完毕， 则只需要等待onload被调用即可
  if (mod.status >= STATUS.LOADING) {
    return
  }

  mod.status = STATUS.LOADING  //// 状态置为模块加载中

  // Emit `load` event for plugins such as combo plugin
  // 调用resolve方法，将模块id转为uri。
  // 比如之前的"mian"，会在前面加上我们之前设置的base，然后在后面拼上js后缀
  // 最后变成: "http://qq.com/web/js/main.js"
  // 处理成具体路径
  var uris = mod.resolve()
  emit("load", uris)

  // 遍历所有依赖项的uri，然后进行依赖模块的实例化
  for (var i = 0, len = uris.length; i < len; i++) {
    mod.deps[mod.dependencies[i]] = Module.get(uris[i])
  }

  // Pass entry to it's dependencies
  // 将entry传入到所有的依赖模块，这个entry是我们在use方法的时候设置的
  mod.pass()

  // If module has entries not be passed, call onload
  //如果这个依赖模块没有另外的依赖模块，那么他的entry就会存在，然后调用onload模块
  if (mod._entry.length) {
    mod.onload()
    return
  }

  // Begin parallel loading
  // 开始进行并行加载
  var requestCache = {}
  var m

  for (i = 0; i < len; i++) {
    m = cachedMods[uris[i]]

    if (m.status < STATUS.FETCHING) {
      m.fetch(requestCache)
    }
    else if (m.status === STATUS.SAVED) {
      m.load()
    }
  }

  // Send all requests at last to avoid cache bug in IE6-9. Issues#808
   // 发送请求进行模块的加载
  for (var requestUri in requestCache) {
    if (requestCache.hasOwnProperty(requestUri)) {
      requestCache[requestUri]()
    }
  }
}

// Call this method when module is loaded
// 模块加载完后调用此方法
Module.prototype.onload = function() {
  var mod = this
  mod.status = STATUS.LOADED

  // When sometimes cached in IE, exec will occur before onload, make sure len is an number
  for (var i = 0, len = (mod._entry || []).length; i < len; i++) {
    var entry = mod._entry[i]
    // 每次加载完毕一个依赖模块，remain就-1
    // 直到remain为0，就表示所有依赖模块加载完毕
    if (--entry.remain === 0) {
      // 最后就会调用entry的callback方法
      // 这就是前面为什么要给每个依赖模块存入entry
      entry.callback()
    }
  }

  delete mod._entry
}

// Call this method when module is 404
// 模块404时 调用此方法
Module.prototype.error = function() {
  var mod = this
  mod.onload()
  mod.status = STATUS.ERROR
}

// Execute a module
// 执行一个模块
Module.prototype.exec = function () {
  var mod = this

  // When module is executed, DO NOT execute it again. When module
  // is being executed, just return `module.exports` too, for avoiding
  // circularly calling
  if (mod.status >= STATUS.EXECUTING) {
    return mod.exports
  }

  mod.status = STATUS.EXECUTING

  if (mod._entry && !mod._entry.length) {
    delete mod._entry
  }

  //non-cmd module has no property factory and exports
  if (!mod.hasOwnProperty('factory')) {
    mod.non = true
    return
  }

  // Create require
  var uri = mod.uri

  function require(id) {
    var m = mod.deps[id] || Module.get(require.resolve(id))
    if (m.status == STATUS.ERROR) {
      throw new Error('module was broken: ' + m.uri)
    }
    return m.exec()
  }

  require.resolve = function(id) {
    return Module.resolve(id, uri)
  }

  require.async = function(ids, callback) {
    Module.use(ids, callback, uri + "_async_" + cid())
    return require
  }

  // Exec factory
  var factory = mod.factory

   // 调用define定义的回调
  // 传入commonjs相关三个参数: require, module.exports, module
  var exports = isFunction(factory) ?
    factory.call(mod.exports = {}, require, mod.exports, mod) :
    factory

  if (exports === undefined) { //如果函数没有返回值，就取mod.exports
    exports = mod.exports 
  }

  // Reduce memory leak
  delete mod.factory

  mod.exports = exports // 返回模块的exports
  mod.status = STATUS.EXECUTED

  // Emit `exec` event
  emit("exec", mod)

  return mod.exports
}

// Fetch a module
// 拉取一个模块
Module.prototype.fetch = function(requestCache) {
  var mod = this
  var uri = mod.uri

  mod.status = STATUS.FETCHING

  // Emit `fetch` event for plugins such as combo plugin
  var emitData = { uri: uri }
  emit("fetch", emitData)
  var requestUri = emitData.requestUri || uri

  // Empty uri or a non-CMD module
  if (!requestUri || fetchedList.hasOwnProperty(requestUri)) {
    mod.load()
    return
  }

  if (fetchingList.hasOwnProperty(requestUri)) {
    callbackList[requestUri].push(mod)
    return
  }

  fetchingList[requestUri] = true
  callbackList[requestUri] = [mod]

  // Emit `request` event for plugins such as text plugin
  emit("request", emitData = {
    uri: uri,
    requestUri: requestUri,
    onRequest: onRequest,
    charset: isFunction(data.charset) ? data.charset(requestUri) : data.charset,
    crossorigin: isFunction(data.crossorigin) ? data.crossorigin(requestUri) : data.crossorigin
  })

  if (!emitData.requested) {
    requestCache ?
      requestCache[emitData.requestUri] = sendRequest :
      sendRequest()
  }

  function sendRequest() {
    seajs.request(emitData.requestUri, emitData.onRequest, emitData.charset, emitData.crossorigin)
  }

  function onRequest(error) {
    delete fetchingList[requestUri]
    fetchedList[requestUri] = true

    // Save meta data of anonymous module
    if (anonymousMeta) {
      Module.save(uri, anonymousMeta)
      anonymousMeta = null
    }

    // Call callbacks
    var m, mods = callbackList[requestUri]
    delete callbackList[requestUri]
    while ((m = mods.shift())) {
      // When 404 occurs, the params error will be true
      if(error === true) {
        m.error()
      }
      else {
        m.load()
      }
    }
  }
}

// Resolve id to uri
// 处理依赖模块的路径 -->  模块的相对地址转换为网络地址
//@params id: "./demo.base"
//@params refUri "http://127.0.0.1:5500/dist/_use_0" 
//@return 返回依赖文件的一个可以访问的网络地址："http://127.0.0.1:5500/dist/demo.base.js"
Module.resolve = function(id, refUri) {
  // Emit `resolve` event for plugins such as text plugin
  var emitData = { id: id, refUri: refUri }
  emit("resolve", emitData)

  return emitData.uri || seajs.resolve(emitData.id, refUri)  //id2Uri
}

// Define a module
// 定义一个模块
/**
 * 
 * @param {*} id 可以是一个函数，也可以是一个对象或字符串
                 id 为对象、字符串时，表示模块的接口就是该对象、字符串。
                 id 为函数时，表示是模块的构造方法
 * @param {*} deps 
 * @param {*} factory 
 */
Module.define = function (id, deps, factory) {
  var argsLen = arguments.length

  // define(factory)
  // 是工厂
  if (argsLen === 1) {
    factory = id
    id = undefined
  }
  else if (argsLen === 2) {
    factory = deps

    // define(deps, factory)
    if (isArray(id)) {
      deps = id
      id = undefined
    }
    // define(id, factory)
    else {
      deps = undefined
    }
  }

  // Parse dependencies according to the module factory code
   // 如果没有直接传入依赖数组
  // 则从factory中提取所有的依赖模块到dep数组中
  // ① 即： 获取代码中声明的依赖关系
  if (!isArray(deps) && isFunction(factory)) {
    deps = typeof parseDependencies === "undefined" ? [] : parseDependencies(factory.toString())
  }

  var meta = {  //模块加载与定义的元数据
    id: id,
    uri: Module.resolve(id),
    deps: deps,
    factory: factory
  }

  // Try to derive uri in IE6-9 for anonymous modules
  if (!isWebWorker && !meta.uri && doc.attachEvent && typeof getCurrentScript !== "undefined") {
    var script = getCurrentScript()

    if (script) {
      meta.uri = script.src
    }

    // NOTE: If the id-deriving methods above is failed, then falls back
    // to use onload event to get the uri
  }

  // Emit `define` event, used in nocache plugin, seajs node version etc
  // 激活define事件, used in nocache plugin, seajs node version etc
  emit("define", meta)

  // ② 保存
  meta.uri ? Module.save(meta.uri, meta) :
    // Save information for "saving" work in the script onload event
    // 在脚本加载完毕的onload事件进行save
    anonymousMeta = meta
}

// Save meta data to cachedMods
//  保存模块数据到cachedMods
Module.save = function(uri, meta) {
  var mod = Module.get(uri)

  // Do NOT override already saved modules
  if (mod.status < STATUS.SAVED) {
    mod.id = meta.id || uri
    mod.dependencies = meta.deps || []
    mod.factory = meta.factory
    mod.status = STATUS.SAVED

    emit("save", mod)
  }
}

/**
 * Get an existed module or create a new one
 * 获取一个已存在的模块或者 创建一个新模块
 * @param {*} uri  "http://127.0.0.1:5500/dist/_use_0" 这是是作为缓存的key值
 * @param {*} deps 需要加载的模块，这是一个模块数组
 */
Module.get = function(uri, deps) {
  return cachedMods[uri] || (cachedMods[uri] = new Module(uri, deps))
}

// Use function is equal to load a anonymous module
// 加载匿名模块时使用
//状态初始化为FETCHING到SAVED
Module.use = function (ids, callback, uri) { ////如果是通过seajs.use调用，uri是自动生成的
  var mod = Module.get(uri, isArray(ids) ? ids : [ids])

  mod._entry.push(mod)  //// 表示当前模块的入口为本身，后面还会把这个值传入他的依赖模块
  mod.history = {}
  mod.remain = 1 // 这个值后面会用来标识依赖模块是否已经全部加载完毕

  mod.callback = function() {
    //模块的回调，执行外部传入的回调
    var exports = []
    var uris = mod.resolve()

    // 执行所有依赖模块的exec方法，存入exports数组
    for (var i = 0, len = uris.length; i < len; i++) {
      exports[i] = cachedMods[uris[i]].exec()
    }

    if (callback) {
      callback.apply(global, exports)
    }

    delete mod.callback
    delete mod.history
    delete mod.remain
    delete mod._entry
  }

  //进行依赖模块的加载
  mod.load()
}


// Public API

seajs.use = function(ids, callback) {
  Module.use(ids, callback, data.cwd + "_use_" + cid())
  return seajs
}

Module.define.cmd = {}
global.define = Module.define


// For Developers

seajs.Module = Module
data.fetchedList = fetchedList
data.cid = cid

seajs.require = function(id) {
  var mod = Module.get(Module.resolve(id))
  if (mod.status < STATUS.EXECUTING) {
    mod.onload()
    mod.exec()
  }
  return mod.exports
}
