'use strict';
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const app = express();
const server = http.createServer(app);
const io = new Server(server);
const PEOPLE = ['Brad','Jarrett','Quinn'];
const CATEGORIES = ['ones','twos','threes','fours','fives','sixes','threeKind','fourKind','fullHouse','smallStraight','largeStraight','yahtzee','chance'];
const FILE = path.join(__dirname,'game-data.json');
const blank = () => Object.fromEntries(CATEGORIES.map(c=>[c,null]));
const makeGame = () => ({ scores:Object.fromEntries(PEOPLE.map(n=>[n,blank()])), turn:0, dice:[1,2,3,4,5], held:[false,false,false,false,false], rolls:0, finished:false, lastEvent:'Welcome to Margus Yahtzee.', lastScored:null, gameNumber:1, revision:0 });
let db = {game:makeGame(), history:[]};
try { const saved=JSON.parse(fs.readFileSync(FILE,'utf8')); if(saved && saved.game && saved.game.scores && saved.history) db=saved; } catch {}
const sessions = new Map(); // token -> player; reconnection tokens held in client localStorage
const connected = new Map(); // socket.id -> player
const online = () => Object.fromEntries(PEOPLE.map(n=>[n,[...connected.values()].includes(n)]));
function persist(){try{fs.writeFileSync(FILE,JSON.stringify(db,null,2));}catch(e){console.warn('Persistence unavailable:',e.message);}}
function subtotal(s){return ['ones','twos','threes','fours','fives','sixes'].reduce((t,c)=>t+(s[c]||0),0);}
function upperBonus(s){return subtotal(s)>=63?35:0;}
function total(s){return CATEGORIES.reduce((t,c)=>t+(s[c]||0),0)+upperBonus(s);}
function score(cat,dice){const count=[0,0,0,0,0,0,0]; dice.forEach(x=>count[x]++); const sum=dice.reduce((a,b)=>a+b,0); const unique=new Set(dice); const has=(arr)=>arr.every(x=>unique.has(x));
  if(['ones','twos','threes','fours','fives','sixes'].includes(cat)) return count[['ones','twos','threes','fours','fives','sixes'].indexOf(cat)+1]*(['ones','twos','threes','fours','fives','sixes'].indexOf(cat)+1);
  if(cat==='threeKind')return count.some(n=>n>=3)?sum:0;
  if(cat==='fourKind')return count.some(n=>n>=4)?sum:0;
  if(cat==='fullHouse')return count.includes(3)&&count.includes(2)?25:0;
  if(cat==='smallStraight')return [ [1,2,3,4],[2,3,4,5],[3,4,5,6] ].some(has)?30:0;
  if(cat==='largeStraight')return [ [1,2,3,4,5],[2,3,4,5,6] ].some(has)?40:0;
  if(cat==='yahtzee')return count.includes(5)?50:0;
  if(cat==='chance')return sum;
  return 0;
}
function view(){return {...db.game, online:online(), history:db.history.slice(-15), players:PEOPLE, totals:Object.fromEntries(PEOPLE.map(n=>[n,total(db.game.scores[n])])), upper:Object.fromEntries(PEOPLE.map(n=>[n,subtotal(db.game.scores[n])])), bonuses:Object.fromEntries(PEOPLE.map(n=>[n,upperBonus(db.game.scores[n])]))};}
function send(){io.emit('state',view());}
function ack(cb,ok,message,extra={}){if(typeof cb==='function')cb({ok,message,...extra});}
function validTurn(socket,cb){const who=connected.get(socket.id);if(!who){ack(cb,false,'Choose your player name first.');return null;}if(db.game.finished){ack(cb,false,'The game is finished.');return null;}if(PEOPLE[db.game.turn]!==who){ack(cb,false,`It is ${PEOPLE[db.game.turn]}'s turn.`);return null;}return who;}
function bump(){db.game.revision++;persist();send();}
app.use(express.static(path.join(__dirname,'public')));
app.get('/health',(_req,res)=>res.json({ok:true}));
io.on('connection',socket=>{
 socket.emit('state',view());
 socket.on('join',({name,token}={},cb)=>{
   if(!PEOPLE.includes(name)){ack(cb,false,'Choose Brad, Jarrett, or Quinn.');return;}
   const current=[...connected.entries()].find(([id,n])=>n===name && id!==socket.id);
   // A player may reclaim a disconnected seat with their token; never displace an active socket.
   if(current){ack(cb,false,`${name} is already connected on another device.`);return;}
   const existing=token && sessions.get(token);
   const newToken=existing===name?token:crypto.randomBytes(24).toString('hex');
   sessions.set(newToken,name);
   connected.set(socket.id,name);socket.data.player=name;
   ack(cb,true,`Welcome, ${name}!`,{token:newToken,name});send();
 });
 socket.on('roll',(_payload,cb)=>{
   const who=validTurn(socket,cb);if(!who)return;
   if(db.game.rolls>=3){ack(cb,false,'You have already rolled three times. Choose a score.');return;}
   if(db.game.rolls>0&&db.game.held.every(Boolean)){ack(cb,false,'All dice are held. Release at least one die.');return;}
   db.game.dice=db.game.dice.map((d,i)=>db.game.rolls===0||!db.game.held[i]?crypto.randomInt(1,7):d);
   db.game.rolls++;db.game.lastEvent=`${who} rolled ${db.game.rolls} of 3.`;db.game.lastScored=null;
   bump();ack(cb,true,'Rolled!');
 });
 socket.on('hold',({index}={},cb)=>{
   const who=validTurn(socket,cb);if(!who)return;
   if(db.game.rolls===0||db.game.rolls>=3){ack(cb,false,'Hold dice after a roll, before the third roll.');return;}
   if(!Number.isInteger(index)||index<0||index>4){ack(cb,false,'Invalid die.');return;}
   db.game.held[index]=!db.game.held[index];bump();ack(cb,true,'Updated.');
 });
 socket.on('score',({category}={},cb)=>{
   const who=validTurn(socket,cb);if(!who)return;
   if(db.game.rolls===0){ack(cb,false,'Roll the dice before scoring.');return;}
   if(!CATEGORIES.includes(category)||db.game.scores[who][category]!==null){ack(cb,false,'That scoring category is not available.');return;}
   const s=db.game.scores[who],dice=db.game.dice, isY=dice.every(x=>x===dice[0]);
   // Official Yahtzee Joker rules: if the Yahtzee box contains 50, a further Yahtzee
   // earns 100 bonus points; the matching upper box must be used if open.
   // If already filled, player may choose any open lower box, then any upper box.
   // A zeroed Yahtzee box never earns bonuses or Joker scores.
   const extraYahtzee=isY&&s.yahtzee===50;
   const matching=['ones','twos','threes','fours','fives','sixes'][dice[0]-1];
   if(extraYahtzee){
     if(s[matching]===null&&category!==matching){ack(cb,false,`Yahtzee bonus rule: score in ${matching} first.`);return;}
     if(s[matching]!==null){const lower=['threeKind','fourKind','fullHouse','smallStraight','largeStraight','yahtzee','chance'];if(lower.some(c=>s[c]===null)&&!lower.includes(category)){ack(cb,false,'Yahtzee bonus rule: choose an open lower-section box.');return;}}
   }
   let points=score(category,dice);
   if(extraYahtzee&&['fullHouse','smallStraight','largeStraight'].includes(category))points={fullHouse:25,smallStraight:30,largeStraight:40}[category];
   s[category]=points;
   // Yahtzee bonus points stored separately and included in totals.
   if(extraYahtzee){db.game.yahtzeeBonuses??={};db.game.yahtzeeBonuses[who]=(db.game.yahtzeeBonuses[who]||0)+100;}
   db.game.lastScored={player:who,category,points,bonus:extraYahtzee?100:0};
   db.game.lastEvent=`${who} scored ${points}${extraYahtzee?' + 100 bonus':''} in ${category}.`;
   const complete=PEOPLE.every(n=>CATEGORIES.every(c=>db.game.scores[n][c]!==null));
   if(complete){db.game.finished=true;db.game.lastEvent='Game complete!';
      const final=PEOPLE.map(n=>({name:n,score:total(db.game.scores[n])+(db.game.yahtzeeBonuses?.[n]||0)})).sort((a,b)=>b.score-a.score);
      db.history.push({date:new Date().toISOString(),gameNumber:db.game.gameNumber,results:final});
   } else {db.game.turn=(db.game.turn+1)%3;}
   db.game.rolls=0;db.game.held=[false,false,false,false,false];db.game.dice=[1,2,3,4,5];
   bump();ack(cb,true,'Score saved.');
 });
 socket.on('newGame',(_payload,cb)=>{
   const who=connected.get(socket.id);if(!who){ack(cb,false,'Join the game first.');return;}
   if(!db.game.finished){ack(cb,false,'A game is in progress. Finish it before starting another.');return;}
   const num=db.game.gameNumber+1;db.game=makeGame();db.game.gameNumber=num;db.game.lastEvent=`${who} started game ${num}.`;bump();ack(cb,true,'New game started.');
 });
 socket.on('disconnect',()=>{connected.delete(socket.id);send();});
});
// Add Yahtzee bonus points to displayed totals.
const oldView=view;
view=function(){const v=oldView();for(const n of PEOPLE)v.totals[n]+=(db.game.yahtzeeBonuses?.[n]||0);return v;};
server.listen(process.env.PORT||3000,()=>console.log(`Margus Yahtzee listening on ${process.env.PORT||3000}`));
