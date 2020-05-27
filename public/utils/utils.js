// fade out

function fadeOut(el) {
  el.style.opacity = 1;

  (function fade() {
    if ((el.style.opacity -= 0.1) < 0) {
      el.style.display = "none";
    } else {
      requestAnimationFrame(fade);
    }
  })();
}

// fade in

function fadeIn(el, display) {
  el.style.opacity = 0;
  el.style.display = display || "block";

  (function fade() {
    var val = parseFloat(el.style.opacity);
    if (!((val += 0.1) > 1)) {
      el.style.opacity = val;
      requestAnimationFrame(fade);
    }
  })();
}

function draggable(el) {
  el.onmousedown = function (e) {
    let IsMousedown = true;
    let LEFT = e.clientX - parseInt(el.style.left);
    let TOP = e.clientY - parseInt(el.style.top);

    document.onmousemove = function (e) {
      if (IsMousedown) {
        el.style.left = e.clientX - LEFT + "px";
        el.style.top = e.clientY - TOP + "px";
      }
    };

    document.onmouseup = function () {
      IsMousedown = false;
    };
  };
}