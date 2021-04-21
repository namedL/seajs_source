define(function(require, exports) {
  console.log("init", "加载第一个依赖文件"),
  exports.subInit = function(){
    console.log("use","调用第一个依赖文件")
  };
});