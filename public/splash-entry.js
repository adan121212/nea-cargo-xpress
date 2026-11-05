(function(){
  'use strict';
  var splash=document.getElementById('neaSplash');
  if(!splash)return;
  var fill=document.getElementById('progressFill');
  var track=document.getElementById('progressTrack');
  var percent=document.getElementById('loadingPercent');
  var message=document.getElementById('loadingMessage');
  var reduced=window.matchMedia&&window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var states=[[0,'Conectando con Panamá...'],[22,'Sincronizando operaciones...'],[48,'Verificando paquetes...'],[73,'Preparando tu espacio de trabajo...'],[92,'Casi listo...'],[100,'¡Bienvenido a NEA!']];
  var duration=reduced?250:3600;
  var started=performance.now();
  var closed=false;
  function close(){
    if(closed)return;
    closed=true;
    splash.classList.add('is-leaving');
    window.setTimeout(function(){if(splash.parentNode)splash.parentNode.removeChild(splash);},reduced?30:500);
  }
  function render(now){
    if(closed)return;
    var progress=Math.min((now-started)/duration,1);
    var value=Math.round(progress*100);
    if(fill)fill.style.width=value+'%';
    if(percent)percent.textContent=value+'%';
    if(track)track.setAttribute('aria-valuenow',String(value));
    for(var i=0;i<states.length;i++){
      if(value>=states[i][0]&&message)message.textContent=states[i][1];
    }
    if(progress<1){window.requestAnimationFrame(render);}
    else{window.setTimeout(close,250);}
  }
  splash.addEventListener('click',close);
  if(reduced){render(started+duration);return;}
  window.requestAnimationFrame(render);
})();