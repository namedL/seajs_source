define(function(require, exports, module){
  console.log("init","加载第一个文件");

  exports.init = function(){
    console.log("use", "使用第一个文件");
    
    let b = require("demo.sub");
    b.subInit();

    let c = require("demo.child");
    c.childInit();
  }
})