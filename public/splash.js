(function(){
  'use strict';
  var root=document.getElementById('neaSplash');
  if(!root)return;
  var fill=document.getElementById('progressFill');
  var track=document.getElementById('progressTrack');
  var percent=document.getElementById('loadingPercent');
  var message=document.getElementById('loadingMessage');
  var reduced=window.matchMedia&&window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var states=[[0,'Conectando con Panamá...'],[22,'Sincronizando operaciones...'],[48,'Verificando paquetes...'],[73,'Preparando tu espacio de trabajo...'],[92,'Casi listo...'],[100,'¡Bienvenido a NEA!']];
  var duration=reduced?250:3600;
  var start=performance.now();
  function frame(now){
    var ratio=Math.min((now-start)/duration,1);
    var value=Math.round(ratio*100);
    if(fill)fill.style.width=value+'%';
    if(percent)percent.textContent=value+'%';
    if(track)track.setAttribute('aria-valuenow',String(value));
    for(var i=0;i<states.length;i++){if(value>=states[i][0]&&message)message.textContent=states[i][1];}
    if(ratio<1){requestAnimationFrame(frame);return;}
    window.setTimeout(function(){
      root.classList.add('is-leaving');
      window.setTimeout(function(){window.location.replace('/app.html');},450);
    },250);
  }
  if(reduced){frame(start+duration);return;}
  requestAnimationFrame(frame);
})();