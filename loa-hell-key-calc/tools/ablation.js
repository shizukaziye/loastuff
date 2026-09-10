// How much do the same-jump bonus and chained middle jumps add? Ablations on the 1750 key.
const fs=require('fs');
eval(fs.readFileSync('data.js','utf8').replace('const REWARDS','global.REWARDS'));
const M=require('../model.js');
// variant model: middle jump not offered on a floor you reached BY a middle jump (repurposes the unused lives bit for Hell)
let src=fs.readFileSync('model.js','utf8')
  .replace('for (let j = mech.midUpMin; j <= mech.midUpMax; j++) vm += mech.midUp * land(f, j, d - 1, s, c, w, r, u, l) / upN;',
           'for (let j = mech.midUpMin; j <= mech.midUpMax; j++) vm += mech.midUp * land(f, j, d - 1, s, c, w, r, u, 0) / upN;')
  .replace('for (let j = jmin; j <= jmax; j++) vn += land(f, j, d - 1, s, c, w, 0, u, l) / jn;',
           'for (let j = jmin; j <= jmax; j++) vn += land(f, j, d - 1, s, c, w, 0, u, 1) / jn;')
  .replace('if (f >= 10 && f % 10 === 0) {','if (f >= 10 && f % 10 === 0 && l === 1) {')
  .replace('if (!nether && l === 0) continue;','');
const V=new Function('module',src+';return module.exports;')({});
const U={red:18,blue:3,shards:0,fusions:125,leap:25,juice:900,gold:1,taps:400,brace:0,karma:275,astroU:0,astroR:0,astroE:15000,elysian:10000,kits:0,books:0,cards:0,gems:0};
const key=REWARDS.keys.hell1750, base=M.MECH_DEFAULTS;
function run(Mod,mech,label){
  const dp=Mod.runDP(key,Mod.bandValues(key,U,mech),U,mech,'hell');
  const out=[];
  for (const [g,d] of [['Rare',5],['Epic',6],['Legendary',7]]) { const fw=Mod.forward(dp,d); out.push({g,ev:dp.start(d),hits:fw.bonusHits}); }
  console.log(label.padEnd(34), out.map(o=>`${o.g} ${Math.round(o.ev).toLocaleString().padStart(8)} (bonus hits ${o.hits.toFixed(4)}, ${Math.round(o.hits*mech.bonusGold)}g)`).join(' | '));
  return out;
}
const A=run(M,base,'full model');
const B=run(M,Object.assign({},base,{bonusGold:0}),'no same-jump bonus');
const C=run(M,Object.assign({},base,{midUp:0}),'no middle jump (bonus on)');
const D=run(M,Object.assign({},base,{midUp:0,bonusGold:0}),'no middle, no bonus');
const E=run(V,base,'middle not re-offered after a middle');
console.log('\nEV contribution (1750 key):');
for (let i=0;i<3;i++){ const g=A[i].g; console.log(`  ${g.padEnd(10)} bonus total ${Math.round(A[i].ev-B[i].ev).toString().padStart(5)}g  | bonus without middle ${Math.round(C[i].ev-D[i].ev).toString().padStart(4)}g  | middle total ${Math.round(A[i].ev-C[i].ev).toString().padStart(5)}g  | of which chained middle ${Math.round(A[i].ev-E[i].ev).toString().padStart(5)}g`); }
// how often does the streak actually hit under the optimal policy, by grade, with/without middle
// forced-middle policy: always take the middle on every multiple of 10 (the "take them" strategy)
let src2=fs.readFileSync('model.js','utf8').replace('if (vm > best) { best = vm; pol = 1; }','best = vm; pol = 1;');
const F=new Function('module',src2+';return module.exports;')({});
console.log('');
const G=run(F,base,'always take the middle');
for (let i=0;i<3;i++) console.log(`  ${A[i].g.padEnd(10)} always-middle vs optimal: ${Math.round(G[i].ev-A[i].ev)}g, streak hits ${(G[i].hits*100).toFixed(2)}% of runs`);
