
(function(){
  var SB="https://lssgyckrehmiljruxerz.supabase.co", KEY="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imxzc2d5Y2tyZWhtaWxqcnV4ZXJ6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODIyMTI3MzQsImV4cCI6MjA5Nzc4ODczNH0.YVOo23FnLqe11s4BFLUPMrDjWiLdzm7VIGrxkQ_Mw9Y";
  var el=function(){return document.getElementById('bf-conn-guard');};
  function show(reason){
    var m=document.getElementById('bf-conn-msg');
    if(m)m.innerHTML='<b>\u26A0 This device can\u2019t reach the Bloomflex database, so your data won\u2019t load.</b> '
      +'The tool itself is fine \u2014 this is your internet/Wi\u2011Fi or a firewall on <u>this network</u> blocking it'
      +(reason?(' ('+reason+')'):'')+'. '
      +'Quick test: open this page on a phone hotspot \u2014 if it loads there, it\u2019s this network. '
      +'Fix: ask IT to allow <code>lssgyckrehmiljruxerz.supabase.co</code>.';
    if(el())el().classList.add('show');
  }
  function hide(){if(el())el().classList.remove('show');}
  function check(){
    var done=false;
    var ctrl=('AbortController'in window)?new AbortController():null;
    var to=setTimeout(function(){if(!done){done=true;if(ctrl)try{ctrl.abort();}catch(e){}show('no response \u2014 timed out');}},9000);
    var opt={cache:'no-store',headers:{apikey:KEY,Authorization:'Bearer '+KEY}};
    if(ctrl)opt.signal=ctrl.signal;
    fetch(SB+'/rest/v1/',opt).then(function(r){
      if(done)return;done=true;clearTimeout(to);hide();
    }).catch(function(e){
      if(done)return;done=true;clearTimeout(to);
      show((e&&/abort/i.test(e.name||''))?'no response \u2014 timed out':'connection blocked');
    });
  }
  if(document.readyState==='complete')setTimeout(check,1200);
  else window.addEventListener('load',function(){setTimeout(check,1200);});
})();
