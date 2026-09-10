// Run the model with Ple0k's sheet gold values and print what the sheet should show.
const fs=require('fs');
eval(fs.readFileSync('data.js','utf8').replace('const REWARDS','global.REWARDS'));
const M=require('../model.js');
// sheet values: stones per 100 (red 500, blue 50), leap 10, abidos 170, breath blue 300 / red 200,
// fused leaps (taps) 250, karma 100, rare sel 500, epic sel 10000, elysian 1500, ability stone (kit) 800,
// bracelet 300, gem8 200k, book 0, card 0, shards 0
const U={red:5,blue:0.5,shards:0,fusions:170,leap:10,juice:200+3*300,gold:1,taps:250,brace:300,karma:100,astroU:0,astroR:500,astroE:10000,elysian:1500,kits:800,books:0,cards:0,gems:200000};
const mech=JSON.parse(JSON.stringify(M.MECH_DEFAULTS));
const sheet={hell:[26239,37418,54802,81158,119446,166933,213988], nwSafe:{rare:89816,epic:95073,legendary:99088}, nwYolo:{rare:46808,epic:43701,legendary:37109}, altar:{rare:20786,epic:13661,legendary:-2279}};
const key=REWARDS.keys.hell1750; const bv=M.bandValues(key,U,mech); const dp=M.runDP(key,bv,U,mech,'hell');
console.log('HELL 1750  grade  model   sheet   diff%');
M.GRADES.forEach((g,i)=>{const v=dp.start(g.desc); console.log(`  ${g.name.padEnd(10)} ${Math.round(v).toString().padStart(8)} ${sheet.hell[i].toString().padStart(8)} ${((v/sheet.hell[i]-1)*100).toFixed(1).padStart(7)}%`);});
// per-band chest values at band 0 and 5 to compare with the sheet's chest table
for (const b of [0,5,10]) console.log('band',b,'chest3',Math.round(bv.chest[3][b]),'base',Math.round(bv.base[b]),'cats',bv.cats[b].map(x=>x.cat+':'+Math.round(x.val)).join(' '));
// forward band distribution for rare (5) and legendary (7)
for (const d of [3,5,7]) { const fw=M.forward(dp,d); console.log('bands d='+d, fw.term.map(b=>((b[0][0]+b[0][1]+b[1][0]+b[1][1])*100).toFixed(2)).join(' '), 'bonus',fw.bonusHits.toFixed(4)); }
// same without the middle jump (midUp=0 makes it never chosen)
const mech0=Object.assign({},mech,{midUp:0}); const dp0=M.runDP(key,M.bandValues(key,U,mech0),U,mech0,'hell');
console.log('no-middle EV', M.GRADES.map(g=>g.name[0]+':'+Math.round(dp0.start(g.desc))).join(' '));
const nwk=REWARDS.keys.nw1750; const fl=M.runDP(nwk,M.bandValues(nwk,U,mech),U,mech,'flame'), fr=M.runDP(nwk,M.bandValues(nwk,U,mech),U,mech,'frost');
console.log('NW flame', M.GRADES.map(g=>g.name[0]+':'+Math.round(fl.start(g.desc))).join(' '));
console.log('NW frost', M.GRADES.map(g=>g.name[0]+':'+Math.round(fr.start(g.desc))).join(' '), ' sheet safe', JSON.stringify(sheet.nwSafe), 'yolo', JSON.stringify(sheet.nwYolo));
const evh=i=>dp.start(M.GRADES[i].desc), evf=i=>fl.start(M.GRADES[i].desc), evr=i=>fr.start(M.GRADES[i].desc);
for (const [g,i] of [['rare',2],['epic',3],['legendary',4]]) { const t=M.transmuteEV(i,evh,evf,evr,mech.tr); console.log('altar',g,'gain',Math.round(t.ev-evh(i)),'sheet',sheet.altar[g]); }
