define(function(require, exports) {
  console.log("init", "加载child依赖文件"),
  exports.childInit = function(){
    console.log("use","调用child依赖文件")
  };
});