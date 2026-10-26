/* Saxlan shared code: runs in the page and on the Apps Script backend (pushed as a .js file).
   Only block comments here and never two slashes in a row inside a string (kept from the Apps Script hosted days). */
var SX = (function () {
  'use strict';
  var SX = {};

  /* ---------- Schoology iCal: parse, find each event's class, add-only import ---------- */
  SX.parseIcal = function (text, utcDate) {
    var lines = String(text).replace(/\r\n/g, '\n').replace(/\n[ \t]/g, '').split('\n');
    var out = [], ev = null;
    var unesc = function (v) { return v.replace(/\\n/gi, '\n').replace(/\\([,;\\])/g, '$1').trim(); };
    lines.forEach(function (line) {
      if (line === 'BEGIN:VEVENT') { ev = {}; return; }
      if (line === 'END:VEVENT') { if (ev) out.push(ev); ev = null; return; }
      if (!ev) return;
      var i = line.indexOf(':'); if (i < 0) return;
      var head = line.slice(0, i), val = line.slice(i + 1), key = head.split(';')[0].toUpperCase();
      if (key === 'DTSTART') {
        var m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?/.exec(val); if (!m) return;
        ev.date = m[7] ? utcDate(new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]))) : m[1] + '-' + m[2] + '-' + m[3];
      } else if (['SUMMARY', 'DESCRIPTION', 'LOCATION', 'CATEGORIES', 'URL'].indexOf(key) >= 0) ev[key.toLowerCase()] = unesc(val);
    });
    return out;
  };
  var words = SX.words = function (s) { return String(s || '').toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').trim(); };
  /* ---------- class names: typed shorthand becomes the proper course name (the page, the server and the Apps Script
     project share this, so a class is grouped the same way everywhere) ---------- */
  /* key (lowercase, punctuation dropped) -> [proper name, short label] */
const COURSE_DICT=(()=>{
  const d={},add=(keys,name,abbr)=>keys.split('|').forEach(k=>{d[k]=[name,abbr];});
  add('ap lang|ap english lang|ap english language|ap language|ap lang and comp|ap lang comp|ap eng lang|ap english language and composition|aplang|apel','AP English Language and Composition','LANG');
  add('ap lit|ap english lit|ap english literature|ap literature|ap lit and comp|ap eng lit|ap english literature and composition|aplit','AP English Literature and Composition','LIT');
  add('apush|ap us history|ap us hist|ap ush|ap united states history|ap american history','AP United States History','APUSH');
  add('ap gov|ap govt|ap us gov|ap us govt|ap government|ap us government|ap usgp|ap gopo|apgov|ap government and politics|ap united states government and politics|ap us government and politics','AP United States Government and Politics','GOV');
  add('ap comp gov|ap comparative gov|ap comparative government|ap comparative government and politics','AP Comparative Government and Politics','CGOV');
  add('ap world|apwh|ap whap|whap|ap world history|ap world history modern','AP World History: Modern','APWH');
  add('ap euro|apeh|ap european history','AP European History','EURO');
  add('ap human geo|ap human geography|aphg|ap hug|aphug','AP Human Geography','HUG');
  add('ap psych|ap psychology|appsych','AP Psychology','PSYCH');
  add('ap micro|ap microeconomics|ap micro econ|ap microecon','AP Microeconomics','MICRO');
  add('ap macro|ap macroeconomics|ap macro econ|ap macroecon','AP Macroeconomics','MACRO');
  add('ap econ|ap economics|ap micro macro|ap macro micro|ap micro and macro|ap macro and micro|ap mac mic|ap mic mac|ap mac mic economics|ap micro macro economics|ap microeconomics and macroeconomics|ap micro and macroeconomics|ap macro and microeconomics','AP Microeconomics and Macroeconomics','ECON');
  add('ap calc ab|calc ab|ap calculus ab|ab calc','AP Calculus AB','CALC');
  add('ap calc bc|calc bc|ap calculus bc|bc calc','AP Calculus BC','CALC');
  add('ap calc|ap calculus','AP Calculus','CALC');
  add('ap stats|ap stat|ap statistics','AP Statistics','STATS');
  add('ap precalc|ap pre calc|ap precalculus','AP Precalculus','PCALC');
  add('ap bio|ap biology','AP Biology','BIO');
  add('ap chem|ap chemistry','AP Chemistry','CHEM');
  add('ap physics 1|ap phys 1|ap physics i|ap physics 1 algebra based','AP Physics 1','PHYS1');
  add('ap physics 2|ap phys 2|ap physics ii|ap physics 2 algebra based','AP Physics 2','PHYS2');
  add('ap physics c mech|ap phys c mech|ap physics c mechanics|ap physics c|ap phys c|ap c mech|ap physics mechanics','AP Physics C: Mechanics','PHYSC');
  add('ap physics c e and m|ap physics c em|ap phys c em|ap phys c e and m|ap e and m|ap physics c electricity and magnetism','AP Physics C: Electricity and Magnetism','EM');
  add('ap physics|ap phys','AP Physics','PHYS');
  add('apes|ap enviro|ap environmental|ap environmental science|ap env sci|ap enviro sci','AP Environmental Science','APES');
  add('ap csa|ap cs a|ap comp sci a|ap compsci a|ap computer science a|ap java','AP Computer Science A','CSA');
  add('ap csp|ap cs p|ap cs principles|ap comp sci principles|ap compsci principles|ap computer science principles','AP Computer Science Principles','CSP');
  add('ap spanish lang|ap spanish language|ap span lang|ap spanish|ap span|ap spanish language and culture','AP Spanish Language and Culture','SPAN');
  add('ap spanish lit|ap span lit|ap spanish literature|ap spanish literature and culture','AP Spanish Literature and Culture','SPLIT');
  add('ap french|ap french lang|ap fren|ap french language|ap french language and culture','AP French Language and Culture','FREN');
  add('ap german|ap german lang|ap german language and culture','AP German Language and Culture','GER');
  add('ap chinese|ap chinese lang|ap mandarin|ap chinese language and culture','AP Chinese Language and Culture','CHIN');
  add('ap japanese|ap japanese lang|ap japanese language and culture','AP Japanese Language and Culture','JPN');
  add('ap italian|ap italian language and culture','AP Italian Language and Culture','ITAL');
  add('ap latin','AP Latin','LAT');
  add('ap art history|ap arth|ap art hist','AP Art History','ARTH');
  add('ap music theory|ap music','AP Music Theory','MUSIC');
  add('ap 2d art|ap 2 d art|ap 2d art and design|ap 2 d art and design','AP 2-D Art and Design','2D');
  add('ap 3d art|ap 3 d art|ap 3d art and design|ap 3 d art and design','AP 3-D Art and Design','3D');
  add('ap drawing','AP Drawing','DRAW');
  add('ap seminar|ap sem','AP Seminar','SEM');
  add('ap research','AP Research','RES');
  add('ap african american studies|ap afam','AP African American Studies','AFAM');
  add('wh1|wh 1|whg1|whg 1|world history 1|world hist 1|world history i|world history and geography 1','World History 1','WH1');
  add('wh2|wh 2|whg2|whg 2|world history 2|world hist 2|world history ii|world history and geography 2','World History 2','WH2');
  add('us va history|us va hist|va us history|us and va history|usva|usvah|vus|us history|us hist|ush|united states history|virginia and united states history','US/VA History','US/VA');
  add('us va gov|va us gov|us va government|us and va government|usvg|gov|govt|government|virginia and united states government','US/VA Government','GOV');
  add('econ|economics','Economics','ECON');
  add('epf|econ pf|econ and pf|econ and personal finance|economics and personal finance|personal finance','Economics and Personal Finance','EPF');
  add('psych|psychology','Psychology','PSYCH');
  add('soc|sociology','Sociology','SOC');
  add('chem|chemistry','Chemistry','CHEM');
  add('bio|biology','Biology','BIO');
  add('phys|physics','Physics','PHYS');
  add('earth sci|earth science|es','Earth Science','ES');
  add('env sci|enviro|environmental science','Environmental Science','ENV');
  add('precalc|pre calc|precalculus|precalc with trig|pre calc with trig|precalc w trig|pre calc w trig|precalculus with trigonometry','Precalculus','PCALC');
  add('calc|calculus','Calculus','CALC');
  add('mvc|multivar|multivariable|multivariable calc|multivariable calculus|multi calc','Multivariable Calculus','MVC');
  add('lin alg|linear algebra','Linear Algebra','LINALG');
  add('stats|stat|statistics','Statistics','STATS');
  add('trig|trigonometry','Trigonometry','TRIG');
  add('alg|algebra','Algebra','ALG');
  add('alg1|alg 1|alg i|algebra 1|algebra i','Algebra 1','ALG1');
  add('alg2|alg 2|alg ii|algebra 2|algebra ii','Algebra 2','ALG2');
  add('geo|geom|geometry','Geometry','GEOM');
  /* gym is FCPS Health and Physical Education (Health and Physical Education 9 and 10) */
  add('gym|gym class|pe|p e|pe class|phys ed|physical ed|physical education|hpe|health pe|health and pe|health and phys ed|health and physical education','Health and Physical Education','HPE');
  add('health|health ed','Health','HLTH');
  /* other common FCPS courses, so they count as known names */
  add('studio art|art studio','Studio Art','ART');
  add('band|concert band|symphonic band','Band','BAND');
  add('wind ensemble|wind symphony','Wind Ensemble','WIND');
  add('jazz band|jazz ensemble','Jazz Ensemble','JAZZ');
  add('orchestra|strings|string orchestra|symphony orchestra','Orchestra','ORCH');
  add('chorus|choir|chorale|concert choir','Chorus','CHOR');
  add('theatre|theater|theatre arts|theater arts|drama','Theatre Arts','THEA');
  add('technical theatre|technical theater|tech theatre|tech theater','Technical Theatre','TTHEA');
  add('photography|photo','Photography','PHOTO');
  add('ceramics','Ceramics','CERAM');
  add('journalism','Journalism','JOUR');
  add('photojournalism|yearbook','Photojournalism','YRBK');
  add('creative writing','Creative Writing','CW');
  add('driver ed|drivers ed|driver education','Driver Education','DRVED');
  add('personal fitness|weight training|weights','Personal Fitness','FIT');
  add('sports medicine|sports med','Sports Medicine','SPMED');
  add('anatomy and physiology|anatomy|a and p','Anatomy and Physiology','ANAT');
  add('oceanography','Oceanography','OCEAN');
  add('astronomy','Astronomy','ASTRO');
  add('geosystems','Geosystems','GEOSYS');
  add('marketing','Marketing','MKTG');
  add('accounting','Accounting','ACCT');
  add('engineering|engineering design','Engineering','ENGR');
  add('cybersecurity|cyber security|cybersecurity systems technology','Cybersecurity','CYBER');
  add('theory of knowledge|tok','Theory of Knowledge','TOK');
  add('cs|comp sci|compsci|computer science','Computer Science','CS');
  add('asl|american sign language','American Sign Language','ASL');
  add('eng|english|ela|lang arts|language arts','English','ENG');
  add('span|spanish|esp|espanol','Spanish','SPAN');
  add('fr|fren|french','French','FREN');
  add('lat|latin','Latin','LAT');
  add('ger|germ|german','German','GER');
  add('chin|chinese|mandarin','Chinese','CHIN');
  add('jpn|jap|japanese','Japanese','JPN');
  add('kor|korean','Korean','KOR');
  add('arab|arabic','Arabic','ARAB');
  add('ital|italian','Italian','ITAL');
  add('rus|russian','Russian','RUS');
  return d;
})();
const ROMAN=/^(i|ii|iii|iv|v|vi|vii|viii|ix|x)$/i;
const UPPER_WORDS=new Set(['ap','ib','us','va','hn','hl','sl','pe','cs','ela','esol','jrotc','stem','de','ii','iii','iv','vi','vii','viii','ix']);
const SMALL_WORDS=new Set(['and','of','the','in','for','to','a','an','with']);
const ckey=s=>String(s||'').toLowerCase().replace(/&/g,' and ').replace(/[^a-z0-9]+/g,' ').trim();
function titleCase(s){
  return s.split(/\s+/).filter(Boolean).map((w,i)=>{
    const lw=w.toLowerCase();
    if(i&&lw==='de')return lw;
    if(UPPER_WORDS.has(lw)||ROMAN.test(w))return w.toUpperCase();
    if(i&&SMALL_WORDS.has(lw))return lw;
    if(w.length>1&&w===w.toUpperCase()&&/[A-Z]/.test(w))return w; /* typed in capitals: keep (DECA, JROTC) */
    return w.charAt(0).toUpperCase()+w.slice(1).toLowerCase();
  }).join(' ');
}
function makeAbbr(name){
  const ws=String(name||'').replace(/[^A-Za-z0-9 ]+/g,' ').split(/\s+/).filter(w=>w&&!SMALL_WORDS.has(w.toLowerCase())&&!/^(ap|ib|hn)$/i.test(w));
  const num=ws.filter(w=>/^\d+$/.test(w)||ROMAN.test(w)).join('').toUpperCase(),words=ws.filter(w=>!(/^\d+$/.test(w)||ROMAN.test(w)));
  const base=words.length>1?words.map(w=>w[0]).join('').toUpperCase().slice(0,5):(words[0]||'').toUpperCase().slice(0,5);
  return (base+num).slice(0,8)||'CLASS';
}
/* looser lookup: every known key with spaces removed, plus initialisms built from each class name
   (AP Physics C: Mechanics -> appcm, apcm, pcm), then a one or two letter typo allowance */
const COURSE_LOOSE=(()=>{
  const m=new Map(),put=(k,v)=>{if(k.length>=3&&!m.has(k))m.set(k,v);};
  Object.keys(COURSE_DICT).forEach(k=>put(k.replace(/ /g,''),COURSE_DICT[k]));
  const names=new Map();Object.values(COURSE_DICT).forEach(v=>names.set(v[0],v));
  names.forEach((v,name)=>{
    const ws=ckey(name).split(' ').filter(w=>w&&!SMALL_WORDS.has(w));
    const ap=ws[0]==='ap'||ws[0]==='ib'?ws[0]:'',rest=ap?ws.slice(1):ws;
    const ini=rest.map(w=>/^\d+$/.test(w)?w:w[0]).join('');
    if(rest.length>=2){put(ap+ini,v);if(ap)put(ap[0]+ini,v);if(ini.length>=3)put(ini,v);}
  });
  return m;
})();
function editDist(a,b,max){
  if(Math.abs(a.length-b.length)>max)return max+1;
  const d=[];for(let i=0;i<=a.length;i++){d[i]=[i];}for(let j=1;j<=b.length;j++)d[0][j]=j;
  for(let i=1;i<=a.length;i++){let best=max+1;for(let j=1;j<=b.length;j++){
    const c=a[i-1]===b[j-1]?0:1;let v=Math.min(d[i-1][j]+1,d[i][j-1]+1,d[i-1][j-1]+c);
    if(i>1&&j>1&&a[i-1]===b[j-2]&&a[i-2]===b[j-1])v=Math.min(v,d[i-2][j-2]+1);d[i][j]=v;if(v<best)best=v;}
    if(best>max)return max+1;}
  return d[a.length][b.length];
}
function courseLoose(k){
  const q=k.replace(/ /g,'');if(q.length<3)return null;
  if(COURSE_LOOSE.has(q))return COURSE_LOOSE.get(q);
  if(q.length<5)return null;
  const max=q.length>=9?2:1;let best=null,bd=max+1,tie=false;
  COURSE_LOOSE.forEach((v,key)=>{if(key.length<4)return;const dd=editDist(q,key,max);
    if(dd<bd){bd=dd;best=v;tie=false;}else if(dd===bd&&best&&best[0]!==v[0])tie=true;});
  if(bd>max||tie)return null;
  /* a typed letter or number that names a different class is not a typo (AP Computer Science D is not A) */
  const ts=k.split(' '),vocab=new Set(ckey(best[0]).split(' '));
  Object.keys(COURSE_DICT).forEach(x=>{if(COURSE_DICT[x][0]===best[0])x.split(' ').forEach(w=>vocab.add(w));});
  if(ts.length>1&&ts.some(w=>w.length<=2&&!vocab.has(w)))return null;
  return best;
}
/* returns {name, abbr, keys}; keys are the shorthands that also mean this class (used to match calendar events) */
function normalizeCourse(input){
  let s=String(input||'').replace(/\s+/g,' ').trim();
  if(!s)return {name:'',abbr:'',keys:[],known:false};
  /* spelled-out programs become their usual initials (Advanced Placement Biology -> AP Biology) */
  s=s.replace(/\badvanced placement\b/gi,'AP').replace(/\binternational baccalaureate\b/gi,'IB').replace(/\bdual[ -]?enrollment\b/gi,'DE');
  /* Dual Enrollment and Online are markers on any class, written before, after or in brackets:
     DE US/VA History, US/VA History DE, Online Econ & PF, English 12 (Dual Enrollment) -> English 12 DE (they go at the end) */
  const mk={de:false,online:false};
  [['de',/^de\b[\s:,\-]*|[\s:,\-]*\bde$|\s*[(\[]\s*de\s*[)\]]\s*/ig],['online',/^(online|oln)\b[\s:,\-]*|[\s:,\-]*\b(online|oln)$|\s*[(\[]\s*(online|oln)\s*[)\]]\s*/ig]].forEach(([key,re])=>{
    let t=s,prev;do{prev=t;t=t.replace(re,' ').replace(/\s+/g,' ').trim();}while(t!==prev);
    if(t!==s&&/[a-z]{2}/i.test(t)){mk[key]=true;s=t;}});
  /* honors in any spelling (Honors, Hon., HN, a trailing H) is written HN, at the end before DE and OLN */
  {const hre=/(^|[\s(\[])(honors|honours|hon\.?|hn)(?=$|[\s)\],:-])|\s+h$/ig,t=s.replace(hre,' ').replace(/[(\[]\s*[)\]]/g,' ').replace(/\s+/g,' ').trim();
    if(t!==s&&/[a-z]{2}/i.test(t)){mk.hn=true;s=t;}}
  if(mk.de||mk.online||mk.hn){const r=normalizeCourse(s),post=(mk.hn?' HN':'')+(mk.de?' DE':'')+(mk.online?' OLN':'');
    return {name:r.name+post,abbr:r.abbr,known:r.known,
      keys:[...new Set([ckey(input),ckey(r.name+post)])].filter(k=>k.length>=2)};}
  /* a level number typed against the word: studio art1 -> studio art 1 (known shorthands like wh1 and alg2 stay) */
  if(!COURSE_DICT[ckey(s)])s=s.replace(/\b([a-z]{3,})(\d{1,2})$/i,'$1 $2');
  /* honors / level suffixes stay as the user wrote them (WH2 HN -> World History 2 HN) */
  let suffix='';
  const sm=/\s+(hn|hon|honors|h|hl|sl|gt)\.?$/i.exec(s);
  if(sm&&s.length>sm[0].length){const w=sm[1];suffix=' '+(/^(hn|hl|sl|gt|h)$/i.test(w)?w.toUpperCase():w);s=s.slice(0,sm.index);}
  let prefix='';
  const pm=/^(ib|honors|hn|de|dual enrollment)\s+/i.exec(s);
  if(pm&&!COURSE_DICT[ckey(s)]){const w=pm[1];prefix=(/^(ib|hn|de)$/i.test(w)?w.toUpperCase():titleCase(w))+' ';s=s.slice(pm[0].length);}
  const keysFor=name=>Object.keys(COURSE_DICT).filter(k=>COURSE_DICT[k][0]===name);
  /* known: the name came from the table (directly, with a level, AP, or a small typo); false when it is only title-cased */
  let known=true;
  const done=(name,abbr,keys)=>({name:(prefix+name+suffix).trim(),abbr:(abbr||makeAbbr(name)).slice(0,8),known,
    keys:[...new Set([ckey(input)].concat(prefix||suffix?[]:keys))].filter(k=>k.length>=2).slice(0,16)});
  const k=ckey(s);
  if(COURSE_DICT[k]){const[n,a]=COURSE_DICT[k];return done(n,a,keysFor(n));}
  /* a level after a known subject: Span 3, Latin III, Eng 10, French4 */
  const lm=/^(.*?)\s*(\d{1,2}|i{1,3}|iv|vi{0,3}|ix|x)$/i.exec(s);
  if(lm&&lm[1]){
    const bk=ckey(lm[1]),lvl=/^\d+$/.test(lm[2])?lm[2]:lm[2].toUpperCase();
    const ap=/^ap\s+/.test(bk)?bk.replace(/^ap\s+/,''):'';
    const hit=COURSE_DICT[bk]||(ap&&COURSE_DICT[ap]);
    if(hit){const n=(ap&&!COURSE_DICT[bk]?'AP ':'')+hit[0]+' '+lvl;return done(n,hit[1]+lvl,[ckey(s)]);}
  }
  /* AP + a known subject: AP Latin, AP Physics */
  if(/^ap\s+/i.test(s)){const rest=COURSE_DICT[ckey(s.replace(/^ap\s+/i,''))];
    if(rest)return done('AP '+rest[0],rest[1],[ckey(s)]);}
  /* shorthand written without spaces, initialisms (APPCM, PCM) and small typos (apppcm) */
  const loose=courseLoose(k);
  if(loose){const[ln,la]=loose;return done(ln,la,keysFor(ln).concat([k]));}
  const n=titleCase(s);known=false;
  return done(n,makeAbbr(n),[]);
}

  SX.normalizeCourse = normalizeCourse; SX.ckey = ckey; SX.makeAbbr = makeAbbr;
  /* a class's canonical key: its proper name, with levels written as numbers (Latin III and Latin 3 are one class) */
  var ROMAN_N = { i: 1, ii: 2, iii: 3, iv: 4, v: 5, vi: 6, vii: 7, viii: 8, ix: 9, x: 10 };
  var KEY_MEMO = {};
  SX.courseKey = function (name) {
    name = String(name || '');
    if (Object.prototype.hasOwnProperty.call(KEY_MEMO, name)) return KEY_MEMO[name];
    return (KEY_MEMO[name] = courseKey(name));
  };
  function courseKey(name) {
    var n = normalizeCourse(name).name || String(name || '');
    var ws = ckey(n).split(' ').map(function (w, i) { return i && ROMAN_N[w] ? String(ROMAN_N[w]) : w; });
    /* honors written before or after the subject is one class (Honors Chemistry, Chemistry HN) */
    var hon = false;
    if (ws.length > 1 && /^(honors|hn)$/.test(ws[0])) { ws.shift(); hon = true; }
    if (ws.length > 1 && /^(honors|hn|h|hon)$/.test(ws[ws.length - 1])) { ws.pop(); hon = true; }
    return ws.join(' ') + (hon ? ' hn' : '');
  }
  /* ---------- course level and FCPS program of studies division (the library filter) ---------- */
  SX.COURSE_LEVELS = [['ap', 'AP'], ['ib', 'IB'], ['de', 'DE/AV'], ['hn', 'HN'], ['reg', 'Regular'], ['oln', 'Online']];
  SX.COURSE_DIVISIONS = [['eng', 'English'], ['math', 'Mathematics'], ['sci', 'Science'], ['ss', 'Social Studies'], ['wl', 'World Languages'],
    ['art', 'Fine Arts'], ['cte', 'Career and Technical Education'], ['hpe', 'Health and PE'], ['other', 'Other']];
  function levelWords(name) {
    var raw = ckey(name), n = ckey(normalizeCourse(name).name || name);
    return { n: n, raw: raw, ws: (n + ' ' + raw).split(' ') };
  }
  /* ap, ib, de (dual enrollment, academy, AV), hn (honors, GT) or reg; the first that applies in that order */
  SX.courseLevel = function (name) {
    var L = levelWords(name), ws = L.ws, has = function (w) { return ws.indexOf(w) >= 0; };
    var last = L.n.replace(/ (oln|online)$/, '').split(' ').pop();
    if (has('ap')) return 'ap';
    if (has('ib') || last === 'hl' || last === 'sl') return 'ib';
    if (has('de') || has('av') || has('academy') || / dual enrollment /.test(' ' + L.n + ' ')) return 'de';
    if (has('hn') || has('hon') || has('honors') || has('gt') || last === 'h') return 'hn';
    return 'reg';
  };
  /* every level that applies: the main one (courseLevel) plus oln when the class is taken online (AP Psychology OLN -> ap, oln) */
  SX.courseLevels = function (name) {
    var L = levelWords(name), out = [SX.courseLevel(name)];
    if (L.ws.indexOf('oln') >= 0 || L.ws.indexOf('online') >= 0) out.push('oln');
    return out;
  };
  /* the first rule that matches the name wins, so the narrow ones go first (Computer Science before Science,
     Latin American Studies before Latin, Art History before History) */
  var DIV_RULES = [
    ['cte', /\b(sports medicine|medical|medicine|pharmacy|pharmacolog\w*|nursing|dental|emt|emergency medical|health informatics|health science\w*|health and medical|therapeutic|veterinary|physical therapy)\b/],
    ['ss', /\blatin american\b|\bpolitical science\b|\bsocial science\b|\bsocial studies\b/],
    ['cte', /\b(family and consumer|consumer science\w*|personal finance|epf|computer science|comp sci|compsci|cs|csa|csp|programming|coding|cyber\w*|information technology|it|computer\w*|web|robotics|engineering|electronics|technology|tech|business|marketing|accounting|entrepreneur\w*|management|culinary|nutrition|food\w*|fashion|interior|child development|early childhood|teachers for tomorrow|criminal justice|jrotc|rotc|military|naval science|aerospace science|automotive|auto|construction|carpentry|cosmetology|welding|hvac|drafting|architect\w*|cad|digital media|multimedia|television|tv production|video production|game design|graphic\w*|keyboarding|office|legal systems|horticulture|agriculture|animal science|economics and personal finance|game design|web design|interior design|graphic design|engineering design|fashion design)\b/],
    ['wl', /\b(spanish|french|latin|german|chinese|mandarin|japanese|korean|arabic|italian|russian|asl|sign language|vietnamese|portuguese|hindi|urdu|hebrew|greek|persian|farsi|turkish|swahili|world language\w*)\b/],
    ['eng', /\blanguage arts\b|\bela\b/],
    ['art', /\b(art|arts|music|band|orchestra|strings|choir|chorus|chorale|vocal|guitar|piano|percussion|jazz|theatre|theater|drama|acting|dance|photography|photo|ceramics|drawing|painting|sculpture|studio|film|2 d|3 d|visual)\b/],
    ['hpe', /\b(pe|gym|physical education|health|driver\w*|weight\w*|fitness|exercise|kinesiology|sports|athletic\w*|lifetime)\b/],
    ['math', /\b(math\w*|algebra|alg|geometry|geom|calculus|calc|precalculus|precalc|statistics|stats|stat|trigonometry|trig|probability|discrete|multivariable|linear algebra|quantitative|functions|data science)\b/],
    ['sci', /\b(science|biology|bio|chemistry|chem|physics|phys|earth|geosystems|environmental|astronomy|oceanography|marine|anatomy|physiology|forensic\w*|ecology|geology|biotech\w*|neuroscience|scientific)\b/],
    ['ss', /\b(history|hist|government|gov|govt|politics|economics|econ|microeconomics|macroeconomics|psychology|psych|sociology|geography|civics|anthropology|philosophy|african american studies|world religions|law|us va|apush|humanities)\b/],
    ['eng', /\b(english|eng|literature|lit|composition|writing|journalism|photojournalism|speech|debate|rhetoric|yearbook|esol|reading|seminar|research|creative writing|newspaper)\b/]
  ];
  /* eng, math, sci, ss, wl, art, cte, hpe or other */
  SX.courseDivision = function (name) {
    var L = levelWords(name), tries = [L.n, L.raw];
    for (var t = 0; t < tries.length; t++) {
      var s = ' ' + tries[t] + ' ';
      for (var i = 0; i < DIV_RULES.length; i++) if (DIV_RULES[i][1].test(s)) return DIV_RULES[i][0];
    }
    return 'other';
  };
  /* Advisory (Saxon Time) is not a class: advisory, adv, saxon time, homeroom */
  SX.isAdvisory = function (name) {
    var k = ckey(name);
    return /^(adv|advis[oe]ry|advisor|saxon|saxon time|homeroom|home room)( class| period| block| time)?$/.test(k) || /\badvis[oe]ry\b|\bsaxon time\b/.test(k);
  };
  /* is a typed class name a known course (true when normalizeCourse found it in the table) */
  SX.courseKnown = function (name) { return !!normalizeCourse(name).known; };
  /* up to n proper course names close to a typed one, best first (AP Computer Science D -> AP Computer Science A, AP Computer Science Principles) */
  var OFFICIAL = (function () {
    var seen = {}, out = [];
    Object.keys(COURSE_DICT).forEach(function (k) { var v = COURSE_DICT[k]; if (!seen[v[0]]) { seen[v[0]] = { name: v[0], abbr: v[1], keys: [] }; out.push(seen[v[0]]); } seen[v[0]].keys.push(k); });
    return out;
  })();
  SX.courseAlternatives = function (text, n) {
    n = n || 3;
    var t = ckey(text), toks = t.split(' ').filter(function (w) { return w && STOP.indexOf(w) < 0 && !/^(class|hon|\d+)$/.test(w); }), ap = /^ap\b/.test(t);
    var lvl = (/ (\d{1,2})( hn| hon| honors| h)?$/.exec(t) || [])[1];
    if (!t) return [];
    var tz = t.replace(/ /g, '');
    var scored = OFFICIAL.map(function (c) {
      var nk = ckey(c.name), best = 0;
      [nk].concat(c.keys).forEach(function (k) {
        var ks = k.split(' ').filter(function (w) { return w && STOP.indexOf(w) < 0; });
        if (!ks.length) return;
        var hit = 0;
        ks.forEach(function (x) { var b = 0; toks.forEach(function (y) { var s2 = tokSim(x, y); if (!s2 && x.length >= 3 && y.length >= 3 && editDist(x, y, 2) <= (x.length >= 6 ? 2 : 1)) s2 = 0.6; b = Math.max(b, s2); }); hit += b; });
        var cover = toks.length ? hit / Math.max(ks.length, toks.length) : 0;
        var kz = k.replace(/ /g, ''), lim = kz.length >= 12 ? 3 : kz.length >= 8 ? 2 : 1, ed = editDist(tz, kz, lim), close = ed <= lim ? (1 - ed / Math.max(4, kz.length)) : 0;
        best = Math.max(best, cover, close);
      });
      /* AP typed: AP courses first; not typed: regular ones first */
      if (/^ap /.test(nk) === ap) best += 0.15;
      return { name: c.name, s: best };
    }).filter(function (x) { return x.s >= 0.45; });
    scored.sort(function (a, b) { return b.s - a.s || a.name.length - b.name.length; });
    var top = scored.length ? scored[0].s : 0, out = [];
    scored.forEach(function (x) {
      if (out.length >= n || x.s < top - 0.3) return;
      /* keep a typed level: Spansh 3 -> Spanish 3 */
      var nm = x.name;
      if (lvl && !/^(ap|ib) /i.test(nm)) { var r = normalizeCourse(nm + ' ' + lvl); if (r.known) nm = r.name; }
      if (out.indexOf(nm) < 0 && ckey(nm) !== t) out.push(nm);
    });
    return out;
  };
  var STOP = ['ap', 'and', 'of', 'the', 'hn', 'honors', 'ib', 'de', 'online', 'dual', 'enrollment', 'la', 'for', 'to', 'in', 'a', 'an', 'with', 'h', 'gt', 'hl', 'sl'];
  /* a Schoology section name without its section, period and teacher parts: "AP Physics C: Mechanics: Section 5 (Barnett)" */
  SX.cleanCourseName = function (s) {
    s = String(s || '').replace(/\s+/g, ' ').trim();
    var prev;
    do {
      prev = s;
      s = s.replace(/\s*\([^()]*\)\s*$/, '')
        .replace(/\s*[:,\-]\s*(section|sec|period|per|block|blk|p)\.?\s*[a-z0-9-]+\s*$/i, '')
        .replace(/\s+(section|sec|period|per|block|blk)\.?\s*[a-z0-9-]+\s*$/i, '')
        .replace(/\s*[:\-]\s*\d{1,4}[a-z]?\s*$/i, '')
        .replace(/\s*\b(sy|fy)?\s*20\d\d\s*[-\/]\s*(20)?\d\d\s*$/i, '')
        .trim();
    } while (s !== prev && s);
    return s.slice(0, 80);
  };
  /* the course an event names explicitly: categories, a course-like location, a "Course:" line, or a [bracketed] prefix */
  SX.eventCourse = function (ev) {
    var c = '';
    if (ev.categories) c = String(ev.categories).split(',')[0];
    if (!c && ev.location && /[a-z]{3}/i.test(ev.location) && !/^(room|rm|bldg|building|gym|library|online|zoom|https?:)/i.test(ev.location.trim()) && ev.location.length <= 80) c = ev.location;
    if (!c && ev.description) { var m = /^\s*(course|class|section|group)\s*[:\-]\s*(.+)$/im.exec(ev.description); if (m) c = m[2]; }
    if (!c && ev.summary) { var b = /^\s*\[([^\]]{2,80})\]/.exec(ev.summary); if (b) c = b[1]; }
    return SX.cleanCourseName(c);
  };
  function editDist(a, b, max) {
    if (Math.abs(a.length - b.length) > max) return max + 1;
    var d = [], i, j;
    for (i = 0; i <= a.length; i++) d[i] = [i];
    for (j = 1; j <= b.length; j++) d[0][j] = j;
    for (i = 1; i <= a.length; i++) {
      for (j = 1; j <= b.length; j++) {
        var c = a[i - 1] === b[j - 1] ? 0 : 1;
        d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + c);
        if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
      }
    }
    return d[a.length][b.length];
  }
  SX.editDist = editDist;
  /* initialisms of a class name: AP Physics C: Mechanics -> appcm, apcm, pcm */
  function initialisms(name) {
    var ws = words(name).split(' ').filter(function (w) { return w && ['and', 'of', 'the', 'in', 'for', 'to', 'a', 'an', 'with'].indexOf(w) < 0; });
    var ap = ws[0] === 'ap' || ws[0] === 'ib' ? ws[0] : '', rest = ap ? ws.slice(1) : ws;
    if (rest.length < 2) return [];
    var ini = rest.map(function (w) { return /^\d+$/.test(w) ? w : w[0]; }).join('');
    return [ap + ini, ap ? ap[0] + ini : '', ini].filter(function (x) { return x.length >= 3; });
  }
  function tokSim(a, b) {
    if (a === b) return 1;
    if (/^\d+$/.test(a) || /^\d+$/.test(b)) return 0;
    if (Math.min(a.length, b.length) >= 4 && (a.indexOf(b) === 0 || b.indexOf(a) === 0)) return 0.9;
    if (a.length >= 5 && b.length >= 5 && editDist(a, b, 1) <= 1) return 0.8;
    return 0;
  }
  /* score how well some text names a class: whole phrase of a name/abbr/raw/key, then initialisms, then fuzzy tokens */
  SX.courseScore = function (text, c) {
    var t = ' ' + words(text) + ' ', toks = t.trim().split(' ');
    var score = 0;
    [c.name, c.raw, c.abbr].concat(c.keys || []).forEach(function (k) {
      var w = words(k); if (w.length >= 3 && t.indexOf(' ' + w + ' ') >= 0) score = Math.max(score, 10 + w.length);
    });
    initialisms(c.name).concat(initialisms(c.raw || '')).forEach(function (ini) { if (toks.indexOf(ini) >= 0) score = Math.max(score, 9 + ini.length); });
    var ct = words(c.name).split(' ').filter(function (x) { return x && STOP.indexOf(x) < 0; });
    if (ct.length) {
      var hit = 0;
      ct.forEach(function (x) { var b = 0; toks.forEach(function (y) { b = Math.max(b, tokSim(x, y)); }); hit += b; });
      /* a different level number (Spanish 3 vs Spanish 4) is a different class */
      var nums = ct.filter(function (x) { return /^\d+$/.test(x); }), tnums = toks.filter(function (x) { return /^\d+$/.test(x); });
      var clash = nums.length && tnums.length && nums.some(function (n) { return tnums.indexOf(n) < 0; });
      if (!clash && hit / ct.length >= 0.6) score = Math.max(score, 5 * hit / ct.length + hit);
    }
    return score;
  };
  /* every class gets its canonical key (stored with the class; records saved before keys existed get one on read) */
  /* the owner's built-in resources (keyed by the owner's class ids) for another account: each of its classes that is
     the same class as one of the owner's (same canonical key) gets that class's resources, under its own id */
  SX.builtInFor = function (res, ownerCourses, myCourses) {
    var out = { courses: {} }, src = (res && res.courses) || {}, byKey = {};
    (ownerCourses || []).forEach(function (c) { if (c && c.id && c.name && src[c.id]) byKey[SX.courseKey(c.name)] = c.id; });
    /* only the items the owner published (public: true in resources.json); everything else stays the owner's */
    (myCourses || []).forEach(function (c) {
      var id = c && c.name && byKey[SX.courseKey(c.name)];
      if (!id || !c.id) return;
      var items = (src[id].items || []).filter(function (it) { return it && it.public; });
      if (items.length) out.courses[c.id] = { items: items };
    });
    return out;
  };
  SX.keyCourses = function (courses) { (courses || []).forEach(function (c) { if (c && c.name) c.key = SX.courseKey(c.name); }); return courses; };
  SX.matchCourse = function (text, courses) {
    /* the same class under another name (AP US History, AP United States History) is a match outright */
    var ck = SX.courseKey(text), same = ck && (courses || []).filter(function (c) { return c && SX.courseKey(c.name) === ck; })[0];
    if (same) return same;
    var best = null, bestScore = 0;
    (courses || []).forEach(function (c) { var s = SX.courseScore(text, c); if (s > bestScore) { bestScore = s; best = c; } });
    return bestScore >= 3 ? best : null;
  };
  SX.PALETTE = ['#2b8cff', '#ff3b30', '#a259ff', '#ff9500', '#00c48c', '#ff2d87', '#5b6cff', '#00bcd4', '#ffcc00', '#34c759', '#ff6b35', '#af52de'];
  SX.MAX_CLASSES = 10;
  /* a new class from a calendar course name; the page turns its name into the proper one (normalizeCourse) on next load */
  function newClass(d, name) {
    var courses = d.settings.courses = d.settings.courses || [];
    var ws = words(name).split(' ').filter(function (w) { return w && STOP.indexOf(w) < 0; });
    var base = (ws.length > 1 ? ws.map(function (w) { return /^\d+$/.test(w) ? w : w[0]; }).join('') : (ws[0] || 'class')).slice(0, 10) || 'class';
    var id = base, i = 2;
    while (courses.some(function (c) { return c.id === id; })) id = base + (i++);
    var c = { id: id, name: name, abbr: (ws.length > 1 ? base : base.slice(0, 5)).toUpperCase().slice(0, 8), raw: name,
      keys: [words(name)].filter(function (k) { return k.length >= 2; }), fresh: true };
    courses.push(c);
    d.settings.colors = d.settings.colors || {};
    var taken = Object.keys(d.settings.colors).map(function (k) { return String(d.settings.colors[k]).toLowerCase(); });
    d.settings.colors[id] = SX.PALETTE.filter(function (x) { return taken.indexOf(x) < 0; })[0] || SX.PALETTE[courses.length % SX.PALETTE.length];
    return c;
  }
  var key3 = function (course, date, title) { return [course, date, title].join('|'); };
  /* Schoology feeds carry no course name: an assignment is routed by its text. Besides the class names themselves
     (courseScore), each subject has a few telltale words, used only for a class of that subject the user has. */
  var SUBJECTS = [
    [/\blatin\b/, 'participle participles declension declensions conjugation ablative accusative genitive dative nominative vocative deponent roman rome romans empire caesar cicero vergil virgil ovid catullus clc myclc memor salvius quintus latin translate translation'],
    [/physics|\bphys\b/, 'kinematics dynamics force forces momentum torque energy newton newtons velocity acceleration projectile projectiles friction rotation rotational oscillation oscillations gravitation circuit circuits lab labs physics'],
    [/calc|calculus/, 'derivative derivatives integral integrals integration differentiation limit limits continuity riemann antiderivative antiderivatives series calculus calc'],
    [/algebra|geometry|precalc|trig|statistics|\bstats?\b|\bmath/, 'equation equations polynomial polynomials quadratic proof proofs theorem probability statistics geometry algebra math'],
    [/history|apush|\bush\b|\bwh\d|world|euro|human geo/, 'dbq leq saq kuhn brinkley colonial colonies revolution reconstruction amendment president presidents treaty war wars timeline apush history'],
    [/gov|government|politics|civics/, 'constitution congress federalism amendment scotus court election elections bill gov government'],
    [/english|\blang\b|\blit\b|literature|composition/, 'essay essays novel rhetorical rhetoric argument argumentative synthesis annotation annotate annotations poem poems poetry thesis english'],
    [/spanish|espa/, 'spanish espanol preterite imperfect subjunctive accent accents cultura vocabulario gramatica conjugation conjugations'],
    [/french/, 'french francais subjonctif passe compose conjugation conjugations'],
    [/chem/, 'mole moles stoichiometry molarity titration periodic bonding reaction reactions enthalpy chemistry chem'],
    [/\bbio|biology/, 'cell cells mitosis meiosis dna rna genetics evolution enzyme enzymes photosynthesis respiration ecology biology bio'],
    [/computer|\bcs\b|\bcs[ap]\b|programming|java|python/, 'code coding program programming java python algorithm algorithms array arrays loop loops'],
    [/econ|micro|macro/, 'supply demand elasticity gdp inflation fiscal monetary market markets marginal utility economics econ'],
    [/psych/, 'neuron neurons behavior conditioning cognitive psychology psych']
  ].map(function (x) { return { re: x[0], kw: x[1].split(' ') }; });
  SX.cleanDesc = function (s) { return String(s || '').replace(/\s*-?\s*Link:\s*\S+\s*$/i, '').trim(); };
  /* the class an assignment belongs to, or null when no class clearly wins */
  SX.routeTask = function (text, courses) {
    var toks = ' ' + words(text) + ' ', scores = (courses || []).map(function (c) {
      var sc = SX.courseScore(text, c), nm = words(c.name + ' ' + (c.raw || ''));
      SUBJECTS.forEach(function (sub) {
        if (!sub.re.test(nm)) return;
        sub.kw.forEach(function (k) { if (toks.indexOf(' ' + k + ' ') >= 0) sc += 3; });
      });
      return { c: c, s: sc };
    }).sort(function (a, b) { return b.s - a.s; });
    if (!scores.length || scores[0].s < 3) return null;
    if (scores.length > 1 && scores[0].s - scores[1].s < 2) return null;
    return scores[0].c;
  };
  /* ---------- learned routing: when the user files an imported item, its title's format becomes a rule ----------
     "HW 3.1, 3.2, and 3.3" -> "hw #", "5/10/2026" -> "#date", "Unit 1 Vocabulary Quiz - Verbs" -> "unit # vocabulary quiz" */
  SX.titleFormat = function (title) {
    var s = ' ' + String(title || '').toLowerCase().replace(/&/g, ' and ') + ' ';
    s = s.replace(/\b\d{1,4}[\/.-]\d{1,2}[\/.-]\d{2,4}\b|\b\d{1,2}\/\d{1,2}\b/g, ' #date ');
    s = s.replace(/\b\d+(?:\.\d+)*[a-z]?\b/g, ' # ');
    /* a run of numbers (3.1, 3.2, and 3.3 / 2.1 - 2.4) is one placeholder */
    s = s.replace(/#(?:(?:\s*(?:,|and|to|through|-|\u2013|&))*\s*#(?!date))+/g, '#');
    s = s.split(/\s[-\u2013\u2014:|(]|[:|(]/)[0];
    var toks = s.replace(/[^a-z#\s]+/g, ' ').split(/\s+/).filter(Boolean).slice(0, 6);
    return toks.join(' ');
  };
  /* words every class uses: a key made only of these (plus numbers) says nothing about the class */
  var GENERIC = ['quiz', 'test', 'exam', 'review', 'notes', 'assignment', 'worksheet', 'reading', 'project', 'lab', 'essay',
    'classwork', 'practice', 'due', 'the', 'a', 'unit', 'chapter', 'part', 'day', 'week', 'final', 'retake', 'study', 'guide'];
  /* a key worth learning: not just a placeholder and not only common words ("hw #" is fine, it came from the user's choice) */
  SX.goodRuleKey = function (k) {
    if (!k) return false;
    if (k === '#date') return true;
    var ws = k.split(' '), real = ws.filter(function (w) { return w !== '#' && w !== '#date'; });
    if (!real.length) return false;
    if (real.every(function (w) { return GENERIC.indexOf(w) >= 0; })) return false;
    if (ws.length === 1 && ['hw', 'homework'].indexOf(ws[0]) >= 0) return false;
    return true;
  };
  SX.ruleCourse = function (title, rules, courses) {
    var k = SX.titleFormat(title), hit = null;
    (rules || []).forEach(function (r) { if (r && r.pattern === k) hit = r; });
    if (!hit) return null;
    return (courses || []).filter(function (c) { return c.id === hit.course; })[0] || null;
  };
  /* rules first, then class names and subject words */
  SX.routeItem = function (title, desc, d) {
    var courses = (d.settings && d.settings.courses) || [];
    return SX.ruleCourse(title, d.routeRules, courses) || SX.routeTask(title + ' ' + (desc || ''), courses);
  };
  /* imported assignments still without a class get one once classes exist; a class the user picked is never changed */
  SX.rerouteIcal = function (d) {
    var n = 0, courses = (d.settings && d.settings.courses) || [];
    if (!courses.length) return 0;
    Object.keys(d.tasks || {}).forEach(function (id) {
      var t = d.tasks[id];
      if (t.source !== 'ical' || t.course || t.done) return;
      var c = SX.routeItem(t.title, t.details, d);
      if (c) { t.course = c.id; n++; }
    });
    return n;
  };
  /* the user filed an item under a class: remember the title's format (a later different choice replaces it), then
     file the other imported items with that format at once: unassigned ones, and ones sitting in the class it was moved
     out of. Returns how many moved. */
  SX.learnRoute = function (d, title, course, from) {
    var k = SX.titleFormat(title);
    if (!SX.goodRuleKey(k) || !course) return 0;
    var rules = (d.routeRules || []).filter(function (r) { return r && r.pattern !== k; });
    rules.push({ pattern: k, course: course, at: Date.now() });
    d.routeRules = rules.slice(-100);
    var n = 0;
    Object.keys(d.tasks || {}).forEach(function (id) {
      var t = d.tasks[id];
      if (t.source === 'ical' && !t.done && t.course !== course && (!t.course || (from && t.course === from)) && SX.titleFormat(t.title) === k) { t.course = course; n++; }
    });
    return n;
  };
  /* a task save from the page: any assignment moved to another class teaches a rule, so later imports with the same
     title format go to that class (and look-alikes already imported follow it) */
  SX.taskSaved = function (d, before, after) {
    if (!before || !after || !after.course || before.course === after.course) return 0;
    if (!((d.settings && d.settings.courses) || []).some(function (c) { return c.id === after.course; })) return 0;
    return SX.learnRoute(d, before.title, after.course, before.course || '');
  };
  var isEventItem = function (ev) { return /\/event\/\d+/i.test(ev.url || ''); };
  var EXAM_RE = /\b(tests?|quiz|quizzes|exams?|retakes?|assessments?|midterms?|finals?|review session)\b/i;
  SX.EXAM_DAYS = 28;
  var addDays = function (ds, n) { var t = new Date(Date.parse(ds + 'T12:00:00Z') + n * 864e5); return t.toISOString().slice(0, 10); };
  /* Adds calendar items dated from..until (homework) or up to EXAM_DAYS ahead (tests, quizzes and the like).
     Assignments (/assignment/ links) become tasks. Calendar events (/event/ links) become tasks when they name a test
     or belong to one of the user's classes; anything else is school-wide and goes to school events, title only. Never edits or removes anything: an item is skipped if a task or
     event (manual, synced, done or edited: imported items remember their original key in ikey) or a deleted-item
     tombstone already has it. opts: {from, until, detect, newId, clean}. With detect, classes are first created from
     course names the calendar names explicitly (Schoology feeds usually name none). */
  /* a deleted assignment stays deleted if it comes back with its date moved (a teacher pushing the due date)
     or filed under another class: the same title within a month of a deleted one is skipped */
  SX.removedMatch = function (removed, date, title) {
    var t = Date.parse(date);
    return Object.keys(removed || {}).some(function (k) {
      if (k.indexOf('ev|') === 0) return false;
      var i = k.indexOf('|'), j = k.indexOf('|', i + 1);
      return i >= 0 && j > i && k.slice(j + 1) === title && Math.abs(Date.parse(k.slice(i + 1, j)) - t) <= 31 * 864e5;
    });
  };
  /* deep-sync results: an assignment already here isn't added again, even after it was moved to another day or class,
     renamed, crossed off or deleted (synced tasks remember the key they arrived with, in ikey) */
  SX.syncIndex = function (d) {
    var have = {};
    Object.keys(d.tasks || {}).forEach(function (id) { var t = d.tasks[id]; have[key3(t.course, t.date, t.title)] = 1; if (t.ikey) have[t.ikey] = 1; });
    Object.keys(d.removed || {}).forEach(function (k) { have[k] = 1; });
    return { have: have };
  };
  SX.syncSeen = function (ix, removed, x) {
    var title = x.title.trim();
    return !!ix.have[key3(x.course, x.date, title)] || SX.removedMatch(removed, x.date, title);
  };
  SX.syncNote = function (ix, x) { var k = key3(x.course, x.date, x.title.trim()); ix.have[k] = 1; return k; };
  SX.importIcal = function (d, events, opts) {
    var clean = opts.clean || function (v, n) { return String(v || '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, n); };
    d.tasks = d.tasks || {}; d.events = d.events || {}; d.settings = d.settings || {}; d.settings.courses = d.settings.courses || [];
    var have = {}, created = 0, added = 0, evAdded = 0;
    /* imported tasks are matched on date+title whatever class they ended up in (routed, or picked by hand) */
    var dt = function (k) { return 'dt|' + String(k).slice(String(k).indexOf('|') + 1); };
    Object.keys(d.tasks).forEach(function (id) { var t = d.tasks[id]; have[key3(t.course, t.date, t.title)] = 1; if (t.ikey) { have[t.ikey] = 1; have[dt(t.ikey)] = 1; } });
    /* a school event repeated day after day (registration open until ...) is added once */
    var evTitle = {};
    Object.keys(d.events).forEach(function (id) { var e = d.events[id]; have['ev|' + e.date + '|' + e.title] = 1; if (e.ikey) have[e.ikey] = 1;
      if (e.source === 'ical') (evTitle[e.title] = evTitle[e.title] || []).push(e.date); });
    var near = function (a, b) { return Math.abs(Date.parse(a) - Date.parse(b)) <= 31 * 864e5; };
    Object.keys(d.removed || {}).forEach(function (k) { have[k] = 1; if (k.indexOf('ev|') !== 0) have[dt(k)] = 1; });
    var classFor = function (ev) {
      var named = SX.eventCourse(ev), courses = d.settings.courses;
      if (named) {
        var m = SX.matchCourse(named, courses);
        if (m) return m;
        if (courses.length < SX.MAX_CLASSES) { created++; return newClass(d, named); }
        return null;
      }
      return SX.routeItem(ev.summary || '', SX.cleanDesc(ev.description), d);
    };
    if (opts.detect) {
      var counts = {}, names = {};
      events.forEach(function (ev) { var n = SX.eventCourse(ev); if (!n) return; var k = words(n); counts[k] = (counts[k] || 0) + 1; names[k] = names[k] || n; });
      Object.keys(counts).sort(function (a, b) { return counts[b] - counts[a]; }).forEach(function (k) {
        if (!SX.matchCourse(names[k], d.settings.courses) && d.settings.courses.length < SX.MAX_CLASSES) { created++; newClass(d, names[k]); }
      });
    }
    var examUntil = opts.examUntil || addDays(opts.today || opts.from, SX.EXAM_DAYS);
    events.forEach(function (ev) {
      if (!ev.date || ev.date < opts.from || ev.date > examUntil) return;
      var title = clean(ev.summary || '', 300); if (!title) return;
      var exam = EXAM_RE.test(title), id, k, c = null;
      if (!exam && ev.date > opts.until && !isEventItem(ev)) return;
      if (isEventItem(ev)) c = classFor(ev);
      if (isEventItem(ev) && !exam && !c) {
        k = 'ev|' + ev.date + '|' + title;
        if (have[k] || (evTitle[title] || []).some(function (x) { return near(x, ev.date); })) return;
        have[k] = 1; (evTitle[title] = evTitle[title] || []).push(ev.date); id = opts.newId();
        d.events[id] = { id: id, date: ev.date, time: '', title: title.slice(0, 200), source: 'ical', ikey: k, created: Date.now() };
        evAdded++;
        return;
      }
      if (!exam && ev.date > opts.until) return;
      if (!isEventItem(ev)) c = classFor(ev);
      var course = c ? c.id : '';
      k = key3(course, ev.date, title);
      if (have[k] || have['dt|' + ev.date + '|' + title] || SX.removedMatch(d.removed, ev.date, title)) return;
      have[k] = 1; have['dt|' + ev.date + '|' + title] = 1;
      id = opts.newId();
      d.tasks[id] = { id: id, course: course, date: ev.date, title: title, details: clean(SX.cleanDesc(ev.description), 2000), done: false,
        exam: exam, kind: exam ? 'exam' : 'hw', source: 'ical', ikey: k, created: Date.now() };
      added++;
    });
    return { added: added, created: created, events: evAdded };
  };

  /* ---------- word filter for anything published: slurs and strong profanity ----------
     Terms (one constant, base64 so the source never shows them) are "mode:stem": s = anywhere in a word (S: also across a
     word split in two, ni gger), p = start of a
     word, w = the whole word (plus s/es/z). Text is normalized first: accents and lookalike letters folded, leetspeak
     mapped, separators between letters dropped (n.i.g, n-i-g), spaced letters joined (n i g), and each stem letter may
     repeat (niiig). An allowlist keeps innocent words (Scunthorpe, Niger, shiitake, snigger) and idioms (chink in the armor). */
  var TERMS_B64 = 'UzpuaWdnLFM6bmlxcSxTOmZhZ2dvdCxzOmZhZ2dpdCx3OmZhZyx3OnRyYW5ueSx3OnRyYW5uaWUsdzpzaGVtYWxlLHc6cmV0YXJkLHc6cmV0YXJkZWQsdzp0YXJkLHc6c3BpYyx3OnNwaWNrLHc6Y2hpbmssdzpnb29rLHc6a2lrZSx3Omt5a2Usczp3ZXRiYWNrLHc6YmVhbmVyLHc6Y29vbixzOnJhZ2hlYWQsczp0b3dlbGhlYWQsdzpwYWtpLHM6amlnYWJvbyxzOmppZ2dhYm9vLHc6d29wLHc6ZGFnbyx3Omd5cHBvLHM6Z29sbGl3b2csczp6aXBwZXJoZWFkLHc6aW5qdW4sdzpyZWRza2luLHc6ZGFya2llLHc6ZGFya3ksUzpmdWNrLHc6ZnVrLHc6ZnVxLHc6ZmNrLHc6ZmNraW5nLHc6ZnVraW4sdzpmdWtpbmcsczpzaGl0LFM6Y3VudCxTOmJpdGNoLHA6d2hvcmUscDpzbHV0LHc6ZGljayx3OmRpY2toZWFkLHc6Y29jayxzOmNvY2tzdWNrLHc6cHVzc3ksdzpwdXNzaWVzLHc6YXNzLHM6YXNzaG9sZSxzOmFyc2Vob2xlLHc6amFja2Fzcyx3OmR1bWJhc3MsdzpiYWRhc3Msdzp0d2F0LHc6d2Fuayx3OndhbmtlcixzOmppenosdzp0aXRzLHc6dGl0dHksdzp0aXR0aWVzLHc6ZGlsZG8sczpibG93am9iLHc6c2thbms=';
  function b64(s) {
    var A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/', out = '', buf = 0, bits = 0;
    for (var i = 0; i < s.length; i++) { var v = A.indexOf(s[i]); if (v < 0) continue; buf = (buf << 6) | v; bits += 6;
      if (bits >= 8) { bits -= 8; out += String.fromCharCode((buf >> bits) & 255); } }
    return out;
  }
  var ALLOW = ['snigg*', 'niggl*', 'niggard*', 'niger', 'nigers', 'nigeria*', 'nigerien*', 'scunthorp*', 'shiitake*', 'shiite*', 'shittim*',
    'cocker*', 'cockerel*', 'bigger', 'trigger*', 'assess*', 'class*', 'sussex', 'grape*', 'therapist*', 'cocktail*', 'analys*',
    'dickens*', 'spice*', 'cockpit*', 'hancock', 'peacock*', 'matsushita', 'pakistan*', 'titan*', 'fukushima', 'fukuoka'];
  var ALLOW_NEXT = { chink: ['in', 'of', 'between'], chinks: ['in', 'of', 'between'], spick: ['and'], spic: ['and'] };
  var HOMO = { 'а': 'a', 'е': 'e', 'о': 'o', 'р': 'p', 'с': 'c', 'у': 'y', 'х': 'x', 'і': 'i', 'ї': 'i', 'ј': 'j', 'ѕ': 's', 'к': 'k', 'м': 'm', 'н': 'h', 'т': 't', 'в': 'b',
    'ԁ': 'd', 'ɡ': 'g', 'ı': 'i', 'ł': 'l', 'ø': 'o', 'ß': 'ss', 'æ': 'ae', 'œ': 'oe', 'đ': 'd', 'ħ': 'h',
    'α': 'a', 'β': 'b', 'ε': 'e', 'ι': 'i', 'κ': 'k', 'ν': 'v', 'ο': 'o', 'ρ': 'p', 'τ': 't', 'υ': 'u', 'χ': 'x', 'γ': 'y' };
  var LEET = { '0': 'o', '3': 'e', '4': 'a', '@': 'a', '5': 's', '$': 's', '7': 't', '+': 't', '8': 'b', '9': 'g', '6': 'g', '2': 'z', '€': 'e', '£': 'l', '¢': 'c', '(': 'c', '<': 'c', '¡': 'i' };
  var TERMS = null;
  function terms() {
    if (TERMS) return TERMS;
    TERMS = b64(TERMS_B64).split(',').map(function (t) {
      var mode = t[0].toLowerCase(), split = t[0] === 'S', stem = t.slice(2), body = stem.split('').map(function (c) { return c + '+'; }).join('');
      var re = mode === 's' ? new RegExp(body) : mode === 'p' ? new RegExp('^' + body) : new RegExp('^' + body + '(?:s|es|z)?$');
      return { mode: mode, split: split, stem: stem, re: re, whole: new RegExp('^' + body + '(?:s|es|z)?$') };
    });
    return TERMS;
  }
  function allowed(tok, next) {
    if (ALLOW_NEXT[tok] && ALLOW_NEXT[tok].indexOf(next) >= 0) return true;
    return ALLOW.some(function (a) { return a.slice(-1) === '*' ? tok.indexOf(a.slice(0, -1)) === 0 : tok === a; });
  }
  function hits(tok, wholeOnly) {
    if (!tok || tok.length < 3) return false;
    return terms().some(function (t) { return (wholeOnly ? t.whole : t.re).test(tok) || (wholeOnly && t.split && t.re.test(tok)); });
  }
  /* canonical text with a map back to the original offsets */
  function canon(text) {
    var out = '', map = [];
    text = String(text || '');
    for (var i = 0; i < text.length; i++) {
      var ch = text[i], cp = text.charCodeAt(i);
      if (cp >= 0xd800 && cp < 0xdc00 && i + 1 < text.length) { ch = text.slice(i, i + 2); }
      var f = ch.normalize ? ch.normalize('NFKD') : ch;
      f = f.replace(/[̀-ͯ​-‏⁠﻿­]/g, '').toLowerCase();
      f = f.split('').map(function (c) { return HOMO[c] || c; }).join('');
      for (var j = 0; j < f.length; j++) { out += f[j]; map.push(i); }
      if (ch.length === 2) i++;
    }
    return { s: out, map: map };
  }
  /* one chunk -> spellings to test: leet mapped (1, | and ! as i, then as l), separators dropped, ph as f */
  function spellings(chunk) {
    var out = [];
    ['i', 'l'].forEach(function (one) {
      var t = chunk.split('').map(function (c) { return c === '1' || c === '|' || c === '!' ? one : (LEET[c] || c); }).join('');
      t = t.replace(/[.\-_'`~^=]/g, '').replace(/ph/g, 'f');
      var wild = t.replace(/[^a-z*#%]/g, '').replace(/[#%]/g, '*');
      out.push(wild);
      if (wild.indexOf('*') >= 0) out.push(wild.replace(/\*/g, ''));
    });
    return out.filter(function (x, i) { return x && out.indexOf(x) === i; });
  }
  function tokenBad(sp, next, wholeOnly) {
    if (sp.indexOf('*') < 0) return !allowed(sp, next) && hits(sp, wholeOnly);
    var n = sp.split('*').length - 1, letters = sp.replace(/\*/g, '').length;
    if (n > 2 || letters < 2 || sp.length < 4) return false;
    var A = 'abcdefghijklmnopqrstuvwxyz', found = false;
    var fill = function (s) {
      if (found) return;
      var k = s.indexOf('*');
      if (k < 0) { if (!allowed(s, next) && hits(s, wholeOnly)) found = true; return; }
      for (var i = 0; i < 26 && !found; i++) fill(s.slice(0, k) + A[i] + s.slice(k + 1));
    };
    fill(sp);
    return found;
  }
  /* returns the flagged spans: [{start, end, text}] in the original text's offsets */
  SX.checkText = function (text) {
    text = String(text || '');
    var c = canon(text), s = c.s, chunks = [], re = /[^\s,;:?"()\[\]{}<>\/\\]+/g, m;
    while ((m = re.exec(s))) {
      var a = m.index, b = a + m[0].length;
      while (a < b && /[.\-_*'#~]/.test(s[a])) a++;
      while (b > a && /[.!\-_*'~,]/.test(s[b - 1])) b--;
      if (b > a) chunks.push({ a: a, b: b, t: s.slice(a, b) });
    }
    var out = [], push = function (i, j) {
      var st = c.map[chunks[i].a], en = c.map[chunks[j].b - 1] + 1;
      if (!out.some(function (o) { return o.start === st && o.end === en; })) out.push({ start: st, end: en, text: text.slice(st, en) });
    };
    var plain = function (k) { return chunks[k] ? chunks[k].t.replace(/[^a-z]/g, '') : ''; };
    chunks.forEach(function (ch, i) {
      if (spellings(ch.t).some(function (sp) { return tokenBad(sp, plain(i + 1), false); })) push(i, i);
    });
    /* spaced-out letters: three or more chunks of one or two characters in a row, joined */
    for (var i = 0; i < chunks.length; i++) {
      var j = i;
      while (j < chunks.length && chunks[j].t.length <= 2) j++;
      if (j - i >= 3) {
        var joined = chunks.slice(i, j).map(function (x) { return x.t; }).join('');
        if (spellings(joined).some(function (sp) { return tokenBad(sp, plain(j), false); })) push(i, j - 1);
      }
      if (j > i) i = j - 1;
    }
    /* a word split in two (fag got): the pair as a whole must be exactly a term */
    for (var k = 0; k + 1 < chunks.length; k++) {
      var p1 = chunks[k].t, p2 = chunks[k + 1].t;
      if (p1.length < 2 || p2.length < 2 || p1.length + p2.length < 5) continue;
      if (spellings(p1 + p2).some(function (sp) { return tokenBad(sp, plain(k + 2), true); })) push(k, k + 1);
    }
    /* keep the tightest spans: a joined pair that only contains an already flagged word adds nothing */
    out = out.filter(function (o) { return !out.some(function (x) { return x !== o && x.start >= o.start && x.end <= o.end && (x.end - x.start) < (o.end - o.start); }); });
    return out.sort(function (x, y) { return x.start - y.start; });
  };
  SX.flagged = function (text) { return SX.checkText(text).map(function (m) { return m.text; }); };

  /* ---------- user documents: a strict whitelist of the formatting the resource pages use ---------- */
  var ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'" };
  SX.decodeEntities = function (s) {
    return String(s).replace(/&(#x[0-9a-f]+|#\d+|[a-z]+\d*);/gi, function (all, e) {
      if (e[0] === '#') { var n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10); return n > 0 && n < 0x110000 ? String.fromCodePoint(n) : ''; }
      return ENT.hasOwnProperty(e.toLowerCase()) ? ENT[e.toLowerCase()] : all;
    });
  };
  var escHtml = function (s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); };
  var BLOCK = { h3: 1, p: 1, ul: 1, li: 1, div: 1 };
  /* h3, p, b, i, ul/li, br, the highlight block (div.ans) and blue text (span.blue); everything else is dropped,
     keeping its text (script and style lose their text too). No attributes survive except those two class names. */
  SX.sanitizeDoc = function (html) {
    html = String(html || '').slice(0, 200000).replace(/<!--[\s\S]*?-->/g, '');
    var out = '', stack = [], re = /<(\/?)([a-zA-Z][a-zA-Z0-9]*)([^>]*)>|([^<]+)|(<)/g, m, skip = 0;
    var open = function (tag, cls) { stack.push(tag); out += '<' + tag + (cls ? ' class="' + cls + '"' : '') + '>'; };
    var close = function (tag) {
      var k = stack.lastIndexOf(tag); if (k < 0) return;
      while (stack.length > k) out += '</' + stack.pop() + '>';
    };
    while ((m = re.exec(html))) {
      if (m[4] !== undefined || m[5] !== undefined) { if (!skip) out += escHtml(SX.decodeEntities(m[4] !== undefined ? m[4] : '<')); continue; }
      var end = m[1] === '/', tag = m[2].toLowerCase(), attrs = m[3] || '';
      if (tag === 'script' || tag === 'style' || tag === 'template' || tag === 'iframe' || tag === 'object') { skip += end ? -1 : 1; if (skip < 0) skip = 0; continue; }
      if (skip) continue;
      var cls = (/\bclass\s*=\s*["']?([^"'>]*)/i.exec(attrs) || [])[1] || '';
      var hasCls = function (c) { return (' ' + cls + ' ').indexOf(' ' + c + ' ') >= 0; };
      var t = tag === 'strong' ? 'b' : tag === 'em' ? 'i' : tag === 'h1' || tag === 'h2' || tag === 'h4' ? 'h3' : tag === 'ol' ? 'ul' : tag;
      if (t === 'br') { if (!end) out += '<br>'; continue; }
      if (t === 'div') t = hasCls('ans') ? 'div' : 'p';
      if (t === 'span' && !hasCls('blue')) continue;
      if (['h3', 'p', 'b', 'i', 'ul', 'li', 'div', 'span'].indexOf(t) < 0) continue;
      if (end) { if (t === 'p' && stack.lastIndexOf('p') < 0 && stack.lastIndexOf('div') >= 0) close('div'); else close(t); continue; }
      if (BLOCK[t]) {
        /* blocks don't nest inside inline tags or other text blocks (a li may hold nothing but inline text) */
        while (stack.length && !BLOCK[stack[stack.length - 1]]) out += '</' + stack.pop() + '>';
        if (t === 'li') { while (stack.length && stack[stack.length - 1] !== 'ul') { if (stack.indexOf('ul') < 0) break; out += '</' + stack.pop() + '>'; } if (stack[stack.length - 1] !== 'ul') open('ul'); }
        else while (stack.length && ['h3', 'p', 'li'].indexOf(stack[stack.length - 1]) >= 0) out += '</' + stack.pop() + '>';
        if (t === 'p' || t === 'h3' || t === 'div') while (stack.length && stack[stack.length - 1] === 'ul') out += '</' + stack.pop() + '>';
      }
      open(t, t === 'div' ? 'ans' : t === 'span' ? 'blue' : '');
    }
    while (stack.length) out += '</' + stack.pop() + '>';
    /* empty formatting goes; an empty paragraph is a blank line the writer left, kept once (never doubled, never at
       the very start or end) */
    return out.replace(/<(b|i|span class="blue"|p|h3|li)>(\s|<br>)*<\/(b|i|span|p|h3|li)>/g, function (a, o, x, c) { return o.split(' ')[0] !== c ? a : c === 'p' ? '<p><br></p>' : ''; })
      .replace(/(<p><br><\/p>){2,}/g, '<p><br></p>').replace(/^(<p><br><\/p>)+|(<p><br><\/p>)+$/g, '').replace(/<ul><\/ul>|<div class="ans">(<p><br><\/p>)?<\/div>/g, '');
  };
  /* plain text of a document, blocks on their own lines (what the word filter and the library search read) */
  SX.docText = function (html) {
    return SX.decodeEntities(String(html || '').replace(/<br>|<\/(p|h3|li|div|ul)>/gi, '\n').replace(/<[^>]*>/g, '')).replace(/\n{2,}/g, '\n').trim();
  };

  /* ---------- resources people write (documents and links), shared limits and cleaning ---------- */
  SX.RES_MAX = 40;            /* resources per account */
  SX.DOC_MAX = 60000;         /* characters of document HTML */
  SX.PDF_MAX = 1048576;       /* bytes per uploaded PDF (stored base64 in the data sheet) */
  SX.PDF_PER_USER = 5;
  var str = function (v, n) { return typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/[—·]/g, ',').replace(/\s+/g, ' ').trim().slice(0, n) : ''; };
  SX.httpsUrl = function (v) { v = String(v || '').trim(); return /^https:\/\/[a-z0-9.-]+\.[a-z]{2,}(?::\d+)?([\/?#][^\s"'<>]*)?$/i.test(v) && v.length <= 1000 ? v : ''; };
  /* input from the page -> {res} or {error}; flags are worked out here, so a flagged resource is never published */
  SX.cleanResource = function (r) {
    if (!r || typeof r !== 'object') return { error: 'bad' };
    var type = r.type === 'link' ? 'link' : r.type === 'doc' ? 'doc' : '';
    if (!type) return { error: 'type' };
    var out = { type: type, title: str(r.title, 120), course: /^[a-z0-9]{1,16}$/.test(r.course || '') ? r.course : '', courseName: str(r.courseName, 80),
      desc: '', html: '', url: '', pdf: '', pdfName: '', public: !!r.public, search: type === 'doc' && !!r.search };
    if (!out.title) return { error: 'title' };
    if (!out.course) return { error: 'course' };
    if (type === 'doc') {
      out.html = SX.sanitizeDoc(r.html);
      if (out.html.length > SX.DOC_MAX) return { error: 'too long' };
    } else {
      out.desc = str(r.desc, 200);
      out.pdf = /^f[a-z0-9]{10,40}$/.test(r.pdf || '') ? r.pdf : '';
      out.pdfName = out.pdf ? str(r.pdfName, 120) : '';
      out.url = out.pdf ? '' : SX.httpsUrl(r.url);
      if (!out.url && !out.pdf && !(r.pdfData && typeof r.pdfData.b64 === 'string')) return { error: 'url' };
    }
    out.flagged = SX.flagged([out.title, out.desc, SX.docText(out.html)].join('\n'));
    return { res: out };
  };
  /* ---------- who may do what with a resource ----------
     The author (owner) and the contributors they name may edit; only the author changes Public/Private, the
     contributor list, or deletes it. A downloaded copy (from) is read-only and follows its source on resync.
     Others see a resource only while it is published (public and not flagged). */
  SX.CONTRIB_MAX = 10;
  var contribs = function (r) { return (r && Array.isArray(r.contributors)) ? r.contributors : []; };
  SX.isAuthor = function (r, me) { return !!r && !r.from && r.owner === me; };
  SX.canEdit = function (r, me) { return !!r && !r.from && (r.owner === me || contribs(r).indexOf(me) >= 0); };
  /* published: public, not flagged, and approved by a moderator ('pending' and 'no' aren't; a resource made
     public before approvals existed has no mod mark and stays published) */
  SX.published = function (r) { return !!r && !r.from && !!r.public && !(r.flagged && r.flagged.length) && r.mod !== 'pending' && r.mod !== 'no'; };
  SX.canSee = function (r, me) { return !!r && (r.owner === me || contribs(r).indexOf(me) >= 0 || SX.published(r)); };
  SX.mine = function (r, me) { return !!r && (r.owner === me || (!r.from && contribs(r).indexOf(me) >= 0)); };
  /* the edit to store, or {error}; exists(name) says whether an account exists */
  SX.mergeEdit = function (old, clean, me, input, exists) {
    if (old && old.from) return { error: 'read only' };
    if (old && !SX.canEdit(old, me)) return { error: 'not yours' };
    var author = old ? old.owner : me, r = {};
    Object.keys(clean).forEach(function (k) { r[k] = clean[k]; });
    if (me !== author) { r.public = !!old.public; r.contributors = contribs(old).slice(); }
    else {
      var list = [], bad = '';
      (Array.isArray(input.contributors) ? input.contributors : []).forEach(function (n) {
        n = String(n || '').trim().toLowerCase();
        if (!n || n === author || list.indexOf(n) >= 0) return;
        if (!/^[a-z0-9_.-]{3,24}$/.test(n) || !exists(n)) { bad = bad || n; return; }
        list.push(n);
      });
      if (bad) return { error: 'nouser', name: bad };
      if (list.length > SX.CONTRIB_MAX) return { error: 'contributors' };
      r.contributors = list;
    }
    r.owner = author; r.from = null;
    r.created = old ? old.created : Date.now(); r.updated = Date.now();
    if (old && me !== author) r.editedBy = me;
    return { res: r };
  };
  /* a downloaded copy brought up to its source's latest version, or null when nothing changes (or the source is
     gone or private: the copy keeps its last version) */
  SX.resyncFields = function (copy, src) {
    if (!copy || !copy.from || !SX.published(src) || src.updated === copy.srcVer) return null;
    var out = {};
    ['type', 'title', 'desc', 'html', 'url', 'pdfName'].forEach(function (k) { out[k] = src[k] || ''; });
    out.search = !!src.search; out.rated = !!src.rated; out.srcVer = src.updated; out.from = { author: src.owner, id: src.id };
    if (src.builtin || copy.item) { out.kind = src.kind || ''; out.item = src.item || null; }
    return out;
  };
  /* ---------- rated resources: a long document waits for the owner's review; a rated one gets a star ----------
     Changing a document's text after review sends it back to the queue (and drops the star). */
  SX.REVIEW_MIN = 1500;       /* characters of document text before a document is reviewed */
  /* waiting for review: marked on save, or a long document saved before reviews existed */
  SX.needsReview = function (r) { return !!r && !r.from && (r.review === 'pending' || (r.review === undefined && r.type === 'doc' && SX.docText(r.html).length >= SX.REVIEW_MIN)); };
  SX.reviewMark = function (old, r) {
    var long = r.type === 'doc' && SX.docText(r.html).length >= SX.REVIEW_MIN;
    if (!long) { r.review = ''; r.rated = false; return r; }
    if (old && old.html === r.html && old.review) { r.review = old.review; r.rated = !!old.rated; return r; }
    r.review = 'pending'; r.rated = false;
    return r;
  };
  /* ---------- publishing: a document needs at least 350 words and fewer than 5 typos, then a moderator approves it ----------
     A typo is a lowercase word the dictionary doesn't know (has(word) answers); capitalised words are taken as names,
     and words with capitals inside (acronyms, CamelCase) are skipped. */
  SX.PUBLISH_WORDS = 350;
  SX.PUBLISH_TYPOS = 5;
  SX.wordCount = function (t) { return (String(t || '').match(/[A-Za-z0-9\u00c0-\u024f]+(?:['\u2019][A-Za-z]+)*/g) || []).length; };
  SX.typos = function (text, has) {
    var out = [];
    (String(text || '').match(/[A-Za-z]+(?:['\u2019][A-Za-z]+)*/g) || []).forEach(function (w) {
      /* contractions: didn't -> did, can't -> can, won't -> will; otherwise the part before the apostrophe (it's, we're) */
      var nt = /^(.+)n['\u2019]t$/i.exec(w), base = nt ? ({ ca: 'can', wo: 'will', sha: 'shall' }[nt[1].toLowerCase()] || nt[1]) : w.split(/['\u2019]/)[0];
      if (base.length < 2 || /[A-Z]/.test(base.slice(1))) return;
      var lw = base.toLowerCase();
      if (has(lw) || base !== lw) return;
      out.push(lw);
    });
    return out;
  };
  SX.publishCheck = function (r, has) {
    if (!r || r.type !== 'doc') return { ok: true };
    var text = SX.docText(r.html), words = SX.wordCount(text);
    if (words < SX.PUBLISH_WORDS) return { ok: false, error: 'short', words: words };
    var t = SX.typos(text, has), uniq = [];
    t.forEach(function (w) { if (uniq.indexOf(w) < 0) uniq.push(w); });
    if (t.length >= SX.PUBLISH_TYPOS) return { ok: false, error: 'typos', words: words, typos: uniq.slice(0, 40), count: t.length };
    return { ok: true, words: words };
  };
  var modKey = function (r) { return [r.type, r.title, r.html, r.url, r.desc, r.pdf].join('\u0001'); };
  /* on save: a public resource that passes the checks waits for a moderator, unless its content is unchanged since
     it was approved; one that fails is saved private, and the reason goes back to the page */
  SX.modMark = function (old, r, has) {
    var same = !!old && modKey(old) === modKey(r), wasOk = !!old && (old.mod === 'ok' || (old.mod === undefined && !!old.public));
    if (!r.public) { r.mod = same && wasOk ? 'ok' : (old && old.mod === 'no' && same ? 'no' : ''); return { ok: true }; }
    if (same && wasOk) { r.mod = 'ok'; return { ok: true }; }
    if (same && old.mod === 'pending') { r.mod = 'pending'; return { ok: true, pending: true }; }
    var c = SX.publishCheck(r, has);
    if (!c.ok) { r.public = false; r.mod = ''; return c; }
    r.mod = 'pending'; r.modBy = '';
    return { ok: true, pending: true, words: c.words };
  };
  /* ---------- the library is open to everyone; until an account has published two resources of its own it may
     download one resource per cooldown ---------- */
  SX.LIB_COOLDOWN = 86400000;
  SX.ownPublished = function (all, me) { return all.filter(function (r) { return r.owner === me && SX.published(r); }).length; };
  SX.libWait = function (all, me, now) {
    if (SX.ownPublished(all, me) >= 2) return 0;
    var last = 0;
    all.forEach(function (r) { if (r.owner === me && r.from && (r.created || 0) > last) last = r.created || 0; });
    return Math.max(0, last + SX.LIB_COOLDOWN - now);
  };
  SX.isPdfUrl = function (u) { return /\.pdf($|[?#])/i.test(String(u || '')); };
  /* the public library: every registered class (by normalized name, with how many people take it) and every published resource */
  /* the owner's PUBLISHED built-in resources (public: true; resources.json and its resyncs, keyed by the owner's class ids) as
     library entries under the owner's class names, with stable ids (b-<class id>-<item id>). Links stay links;
     everything else (documents, vocabulary, timelines, guides, answer keys, practice) carries the item itself as
     type 'builtin', drawn by the same code as the Resources page. updated is a hash of the content, so a downloaded
     copy resyncs when the item changes. They skip moderation (the owner's own material). */
  var verOf = function (s) { var h = 5381; s = String(s); for (var i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0; return (h >>> 0) || 1; };
  SX.builtInLibrary = function (res, ownerCourses, owner) {
    var out = [], src = (res && res.courses) || {}, seen = {};
    (ownerCourses || []).forEach(function (c) {
      var items = c && c.id && c.name && src[c.id] && src[c.id].items;
      (items || []).forEach(function (it, i) {
        if (!it || typeof it !== 'object' || !it.title || !it.public) return;
        var link = !it.type && SX.httpsUrl(it.url);
        if (!link && !it.type) return;
        var id = 'b-' + c.id + '-' + (String(it.id || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 40) || i);
        if (seen[id]) return; seen[id] = 1;
        out.push({ id: id, owner: owner, contributors: [], course: c.id, courseName: c.name, builtin: true, public: true, flagged: [],
          type: link ? 'link' : 'builtin', kind: link ? '' : String(it.type), title: String(it.title).slice(0, 120), desc: '', html: '',
          url: link || '', item: link ? null : it, created: 0, updated: verOf(link ? link + ' ' + it.title : JSON.stringify(it)) });
      });
    });
    return out;
  };
  SX.builtInById = function (list, id) { return (list || []).filter(function (r) { return r.id === id; })[0] || null; };
  SX.library = function (classLists, resources, ownerAuthor) {
    var cls = {};
    classLists.forEach(function (names) {
      var seen = {};
      /* one entry per canonical class: AP US History and AP United States History are counted together */
      (names || []).forEach(function (n) { var k = SX.courseKey(n); if (!k || seen[k]) return; seen[k] = 1; cls[k] = cls[k] || { name: normalizeCourse(n).name || n, key: k, count: 0 }; cls[k].count++; });
    });
    var res = resources.filter(SX.published).map(function (r) {
      var k = SX.courseKey(r.courseName); if (k && !cls[k]) cls[k] = { name: normalizeCourse(r.courseName).name || r.courseName, key: k, count: 0 };
      var o = { id: r.id, author: r.owner, contributors: contribs(r), course: k ? cls[k].name : r.courseName, courseKey: k, type: r.type, title: r.title, desc: r.desc || '', html: r.html || '',
        url: r.url || '', pdf: !!r.pdf, pdfName: r.pdfName || '', search: !!r.search, rated: !!r.rated, from: r.from || null, updated: r.updated || r.created || 0 };
      if (r.builtin) { o.builtin = true; o.kind = r.kind || ''; o.item = r.item || null; }
      return o;
    });
    var classes = Object.keys(cls).map(function (k) { return cls[k]; }).sort(function (a, b) { return b.count - a.count || (a.name < b.name ? -1 : 1); });
    return { classes: classes, resources: res };
  };

  /* ---------- friends and messages ----------
     io: get(kind, key) -> string|null, put(kind, key, string), exists(name), now(). Kinds:
       social  account -> {f friends, i incoming requests, o outgoing requests,
                           c {conversation id: {l last message time, r read time, p preview, t title}}}
       chat    conversation id -> {m [[from, time, text], ...] oldest first, g {name, members, owner} for a group}
     A direct conversation's id is "d:" + the two names sorted and joined with "|"; a group's is "g" + random.
     Each account also has an inbox (conversation id "inbox", chat key "x:" + name): messages from the site itself,
     sent by administrators or automatically (a suggestion marked done), read only. */
  SX.CHAT_KEEP = 3000;         /* messages kept per conversation */
  SX.CHAT_PAGE = 60;           /* messages per load */
  SX.CHAT_LEN = 1000;          /* characters per message */
  SX.FRIENDS_MAX = 100;
  SX.GROUP_MAX = 20;           /* people per group */
  SX.dmId = function (a, b) { return 'd:' + (a < b ? a + '|' + b : b + '|' + a); };
  var jget = function (io, kind, key) { var v = io.get(kind, key), o = null; try { o = v ? JSON.parse(v) : null; } catch (e) { o = null; } return o && typeof o === 'object' ? o : null; };
  var soc = function (io, n) { var o = jget(io, 'social', n) || {};
    ['f', 'i', 'o'].forEach(function (k) { if (!Array.isArray(o[k])) o[k] = []; });
    if (!o.c || typeof o.c !== 'object') o.c = {}; return o; };
  var socPut = function (io, n, o) { io.put('social', n, JSON.stringify(o)); };
  var drop = function (a, x) { var i = a.indexOf(x); if (i >= 0) a.splice(i, 1); };
  var socErr = function (code) { var e = new Error(code); e.social = code; throw e; };
  var okName = function (n) { return /^[a-z0-9_.-]{3,24}$/.test(n); };
  var clip = function (t, n) { return typeof t === 'string' ? t.replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '').trim().slice(0, n) : ''; };
  /* who is in a conversation (null: no such conversation, or not allowed) */
  var members = function (io, me, id, a) {
    if (id === SX.INBOX) { var ib = jget(io, 'chat', 'x:' + me) || { m: [] }; if (!Array.isArray(ib.m)) ib.m = [];
      return a.c[id] ? { list: [me], system: true, ch: ib } : null; }
    var m = /^d:([a-z0-9_.-]{3,24})\|([a-z0-9_.-]{3,24})$/.exec(id);
    if (m) { if (m[1] !== me && m[2] !== me) return null; var other = m[1] === me ? m[2] : m[1];
      return a.f.indexOf(other) >= 0 || a.c[id] ? { list: [me, other], other: other, ch: jget(io, 'chat', id) || { m: [] } } : null; }
    if (!/^g[a-z0-9]{10,30}$/.test(id)) return null;
    var ch = jget(io, 'chat', id);
    if (!ch || !ch.g || ch.g.members.indexOf(me) < 0) return null;
    if (!Array.isArray(ch.m)) ch.m = [];
    return { list: ch.g.members.slice(), group: true, ch: ch };
  };
  SX.socialState = function (io, me) {
    var o = soc(io, me);
    var convs = Object.keys(o.c).map(function (id) { var c = o.c[id];
      return { id: id, title: c.t || '', group: id.charAt(0) === 'g', system: id === SX.INBOX, last: c.l || 0, unread: (c.l || 0) > (c.r || 0), preview: c.p || '' }; })
      .sort(function (x, y) { return y.last - x.last; });
    return { friends: o.f.slice().sort(), incoming: o.i.slice(), outgoing: o.o.slice(), convs: convs };
  };
  /* a message from the site into one account's inbox (false: no such account, or nothing to say) */
  SX.INBOX = 'inbox';
  SX.INBOX_KEEP = 200;
  SX.inboxAdd = function (io, to, text, site) {
    to = String(to || '').trim().toLowerCase(); text = clip(text, SX.CHAT_LEN);
    if (!okName(to) || !text || !io.exists(to)) return false;
    var key = 'x:' + to, ch = jget(io, 'chat', key) || { m: [] }, now = io.now();
    if (!Array.isArray(ch.m)) ch.m = [];
    if (ch.m.length && ch.m[ch.m.length - 1][1] >= now) now = ch.m[ch.m.length - 1][1] + 1;
    ch.m.push(['system', now, text]); ch.m = ch.m.slice(-SX.INBOX_KEEP);
    io.put('chat', key, JSON.stringify(ch));
    var o = soc(io, to), e = o.c[SX.INBOX] || { r: 0 };
    e.l = now; e.p = text.slice(0, 80); e.t = site || e.t || 'Inbox'; o.c[SX.INBOX] = e; socPut(io, to, o);
    return true;
  };
  /* what a suggestion's sender is told when it is marked done */
  SX.suggDoneText = function (s) {
    var t = clip(s && s.text, 2000).replace(/\s+/g, ' '), q = t.length > 80 ? t.slice(0, 77).replace(/\s+\S*$/, '') + '...' : t;
    return (s && s.kind === 'bug' ? 'Your bug report "' + q + '" was fixed' : 'Your suggestion "' + q + '" was accepted');
  };
  SX.suggDoneNotify = function (io, s, site) {
    if (!s || !s.user || s.user === 'guest') return false;
    return SX.inboxAdd(io, s.user, SX.suggDoneText(s), site);
  };
  var linkFriends = function (io, me, a, name, b) { drop(a.i, name); drop(a.o, name); drop(b.i, me); drop(b.o, me);
    if (a.f.indexOf(name) < 0) a.f.push(name); if (b.f.indexOf(me) < 0) b.f.push(me); };
  SX.social = function (io, me, op, args) {
    args = args && typeof args === 'object' ? args : {};
    if (op === 'state') return SX.socialState(io, me);
    /* one round trip for the chat page: the lists, plus any new messages in the open conversation */
    if (op === 'sync') {
      var out0 = { state: SX.socialState(io, me) };
      if (args.id) { try { out0.open = SX.social(io, me, 'messages', { id: args.id, since: args.since }); } catch (e) { if (!e.social) throw e; out0.open = { error: e.social }; } }
      return out0;
    }
    var a = soc(io, me), name = String(args.name || '').trim().toLowerCase(), id = String(args.id || '');
    if (op === 'request') {
      if (!okName(name) || !io.exists(name)) socErr('nouser');
      if (name === me) socErr('self');
      if (a.f.indexOf(name) >= 0) return SX.socialState(io, me);
      var b = soc(io, name);
      if (a.f.length >= SX.FRIENDS_MAX || b.f.length >= SX.FRIENDS_MAX) socErr('full');
      /* they already asked: asking back makes you friends */
      if (a.i.indexOf(name) >= 0) linkFriends(io, me, a, name, b);
      else { if (a.o.indexOf(name) < 0) a.o.push(name); if (b.i.indexOf(me) < 0) b.i.push(me); a.o = a.o.slice(-SX.FRIENDS_MAX); b.i = b.i.slice(-SX.FRIENDS_MAX); }
      socPut(io, me, a); socPut(io, name, b);
      return SX.socialState(io, me);
    }
    if (op === 'accept' || op === 'decline' || op === 'remove' || op === 'cancel') {
      if (!okName(name)) socErr('nouser');
      var c = soc(io, name);
      if (op === 'accept') { if (a.i.indexOf(name) < 0) socErr('norequest'); linkFriends(io, me, a, name, c); }
      else { if (op === 'remove') { drop(a.f, name); drop(c.f, me); } drop(a.i, name); drop(a.o, name); drop(c.i, me); drop(c.o, me); }
      socPut(io, me, a); socPut(io, name, c);
      return SX.socialState(io, me);
    }
    /* administrators: a message from the site to one account's inbox, or to everyone's ("*") */
    if (op === 'sysSend') {
      if (!io.isAdmin || !io.isAdmin(me)) socErr('notallowed');
      var stxt = clip(args.text, SX.CHAT_LEN), to = String(args.to || '').trim().toLowerCase();
      if (!stxt) socErr('empty');
      var tos = to === '*' ? (io.users ? io.users() : []) : [to];
      if (to !== '*' && (!okName(to) || !io.exists(to))) socErr('nouser');
      var sent = 0; tos.forEach(function (u) { if (SX.inboxAdd(io, u, stxt, io.site)) sent++; });
      return { ok: true, sent: sent };
    }
    if (op === 'group') {
      var title = clip(args.title, 60), list = [me];
      (Array.isArray(args.members) ? args.members : []).forEach(function (n) { n = String(n || '').trim().toLowerCase(); if (a.f.indexOf(n) >= 0 && list.indexOf(n) < 0) list.push(n); });
      if (list.length < 2) socErr('members');
      if (list.length > SX.GROUP_MAX) socErr('toobig');
      var gid = 'g' + io.rand(18), now0 = io.now();
      io.put('chat', gid, JSON.stringify({ m: [], g: { name: title, members: list, owner: me } }));
      list.forEach(function (n) { var x = n === me ? a : soc(io, n); x.c[gid] = { l: now0, r: n === me ? now0 : 0, p: '', t: title || list.join(', ') }; if (n !== me) socPut(io, n, x); });
      socPut(io, me, a);
      return { ok: true, id: gid, state: SX.socialState(io, me) };
    }
    var cv = members(io, me, id, a);
    if (!cv) socErr('noconv');
    var info = function () { return { id: id, group: !!cv.group, system: !!cv.system, members: cv.list,
      title: cv.system ? ((a.c[id] && a.c[id].t) || 'Inbox') : cv.group ? (cv.ch.g.name || '') : cv.other, owner: cv.group ? cv.ch.g.owner : '' }; };
    if (op === 'messages') {
      /* since: newer than this time (polling); before: one page older than this time (scrolling up); neither: the latest page */
      var all = cv.ch.m, since = Number(args.since) || 0, before = Number(args.before) || 0, out;
      if (since) out = all.filter(function (x) { return x[1] > since; });
      else { var end = all.length; if (before) { end = 0; while (end < all.length && all[end][1] < before) end++; } out = all.slice(Math.max(0, end - SX.CHAT_PAGE), end); }
      var lastT = all.length ? all[all.length - 1][1] : 0, mine = a.c[id];
      if (mine && (mine.r || 0) < lastT) { mine.r = lastT; socPut(io, me, a); }
      return { info: info(), more: !since && out.length > 0 && all.length > 0 && all[0][1] < out[0][1],
        messages: out.map(function (x) { return { from: x[0], time: x[1], text: x[2] }; }) };
    }
    if (op === 'send') {
      if (cv.system) socErr('readonly');
      if (!cv.group && a.f.indexOf(cv.other) < 0) socErr('notfriend');
      var text = clip(args.text, SX.CHAT_LEN), now = io.now();
      if (!text) socErr('empty');
      var ms = cv.ch.m;
      /* at most 20 messages a minute from one person in one conversation */
      if (ms.filter(function (x) { return x[0] === me && x[1] > now - 60000; }).length >= 20) socErr('slow');
      if (ms.length && ms[ms.length - 1][1] >= now) now = ms[ms.length - 1][1] + 1;
      ms.push([me, now, text]); cv.ch.m = ms.slice(-SX.CHAT_KEEP);
      io.put('chat', id, JSON.stringify(cv.ch));
      var pv = (cv.group ? me + ': ' : '') + text.slice(0, 80);
      cv.list.forEach(function (n) { var x = n === me ? a : soc(io, n), e = x.c[id] || {};
        e.l = now; e.p = pv; e.t = cv.group ? (cv.ch.g.name || cv.list.join(', ')) : (n === me ? cv.other : me);
        if (n === me) e.r = now; x.c[id] = e; if (n !== me) socPut(io, n, x); });
      socPut(io, me, a);
      return { ok: true, time: now };
    }
    if (op === 'leave') {
      if (!cv.group) { delete a.c[id]; socPut(io, me, a); return SX.socialState(io, me); }
      drop(cv.ch.g.members, me); delete a.c[id];
      if (cv.ch.g.owner === me) cv.ch.g.owner = cv.ch.g.members[0] || '';
      io.put('chat', id, JSON.stringify(cv.ch)); socPut(io, me, a);
      return SX.socialState(io, me);
    }
    if (op === 'rename' && cv.group) {
      cv.ch.g.name = clip(args.title, 60); io.put('chat', id, JSON.stringify(cv.ch));
      cv.list.forEach(function (n) { var x = n === me ? a : soc(io, n); if (x.c[id]) x.c[id].t = cv.ch.g.name || cv.list.join(', '); socPut(io, n, x); });
      return { ok: true, info: info() };
    }
    if (op === 'add' && cv.group) {
      if (a.f.indexOf(name) < 0) socErr('notfriend');
      if (cv.ch.g.members.indexOf(name) >= 0) return { ok: true, info: info() };
      if (cv.ch.g.members.length >= SX.GROUP_MAX) socErr('toobig');
      cv.ch.g.members.push(name); cv.list.push(name); io.put('chat', id, JSON.stringify(cv.ch));
      var y = soc(io, name); y.c[id] = { l: io.now(), r: 0, p: '', t: cv.ch.g.name || cv.list.join(', ') }; socPut(io, name, y);
      return { ok: true, info: info() };
    }
    socErr('bad');
  };
  /* ---------- suggestions and bug reports from the opening screen ---------- */
  SX.cleanSuggestion = function (o) {
    o = o && typeof o === 'object' ? o : {};
    var text = typeof o.text === 'string' ? o.text.replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '').trim().slice(0, 2000) : '';
    if (!text) return { error: 'empty' };
    return { kind: o.kind === 'bug' ? 'bug' : 'idea', text: text };
  };

  /* ---------- multiplayer: rooms of these games (the page's GAMES labeled Multiplayer) need a signed-in account ---------- */
  SX.MP_GAMES = ['chess', 'geodash', 'appel', 'metrica-wave'];

  if (typeof module !== 'undefined' && module.exports) module.exports = SX;
  return SX;
})();
