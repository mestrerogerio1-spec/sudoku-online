import './styles.css';
import { useState, useEffect, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { io } from 'socket.io-client';
import confetti from 'canvas-confetti';
import {
  Undo2, Trash2, PenLine, Lightbulb,
  CirclePause, CirclePlay,
  Trophy, Users, Skull, PartyPopper,
  MessageCircle, Share2, Clipboard, Hourglass
} from 'lucide-react';
// deploy v2

// DEPOIS (correto)
let _socket = null;
function getSocket() {
  if (!_socket) _socket = io('https://sudoku-online-fphf.onrender.com', { autoConnect: true, reconnection: true });
  return _socket;
}
}

/* ── Sons ─────────────────────────────────────────────────────── */
const AudioCtx = window.AudioContext || window.webkitAudioContext;
let _actx = null;
function getACtx() { if (!_actx && AudioCtx) _actx = new AudioCtx(); return _actx; }
function playTone(freq, dur=0.08, type='sine', vol=0.18) {
  try { const ctx=getACtx(); if(!ctx) return; const o=ctx.createOscillator(),g=ctx.createGain(); o.connect(g);g.connect(ctx.destination); o.type=type;o.frequency.value=freq; g.gain.setValueAtTime(vol,ctx.currentTime);g.gain.exponentialRampToValueAtTime(0.001,ctx.currentTime+dur); o.start();o.stop(ctx.currentTime+dur); } catch {}
}
const SFX = {
  click: ()=>playTone(520,0.06,'sine',0.12),
  error: ()=>{ playTone(200,0.12,'sawtooth',0.14); setTimeout(()=>playTone(160,0.15,'sawtooth',0.10),100); },
  hint:  ()=>{ playTone(660,0.08); setTimeout(()=>playTone(880,0.10),90); },
  undo:  ()=>playTone(380,0.08,'triangle',0.12),
  win:   ()=>{ [523,659,784,1047].forEach((f,i)=>setTimeout(()=>playTone(f,0.18,'sine',0.2),i*110)); },
  lose:  ()=>{ [400,320,240].forEach((f,i)=>setTimeout(()=>playTone(f,0.2,'sawtooth',0.15),i*130)); },
  note:  ()=>playTone(740,0.05,'triangle',0.08),
};

function fireConfetti() {
  const o={particleCount:80,spread:70};
  confetti({...o,angle:60,origin:{x:0,y:0.55}});
  confetti({...o,angle:120,origin:{x:1,y:0.55}});
  setTimeout(()=>confetti({particleCount:50,spread:100,origin:{y:0.4},startVelocity:30}),300);
}

/* ── Helpers ──────────────────────────────────────────────────── */
function parsePuzzle(str) {
  return Array.from({length:9},(_,r)=>Array.from({length:9},(_,c)=>{ const ch=str[r*9+c]; return ch>='1'&&ch<='9'?parseInt(ch):0; }));
}
function isFixed(str,r,c){ const ch=str[r*9+c]; return ch>='1'&&ch<='9'; }
function getConflicts(board,r,c,val){
  if(val===0) return [];
  const hits=[];
  for(let i=0;i<9;i++){ if(i!==c&&board[r][i]===val)hits.push(`${r}-${i}`); if(i!==r&&board[i][c]===val)hits.push(`${i}-${c}`); }
  const br=Math.floor(r/3)*3,bc=Math.floor(c/3)*3;
  for(let dr=0;dr<3;dr++) for(let dc=0;dc<3;dc++){ const nr=br+dr,nc=bc+dc; if((nr!==r||nc!==c)&&board[nr][nc]===val)hits.push(`${nr}-${nc}`); }
  return hits;
}
function isSolved(board,sol){ return board.every((row,r)=>row.every((cell,c)=>cell===parseInt(sol[r*9+c]))); }
function formatTime(s){ return `${String(Math.floor(s/60)).padStart(2,'0')}:${String(s%60).padStart(2,'0')}`; }
function countRemaining(board){ const c=Array(10).fill(9); board.flat().forEach(v=>{ if(v>0)c[v]--; }); return c; }

const MAX_HINTS=3;
const DIFF_LABELS={ easy:'Fácil', medium:'Médio', hard:'Difícil', expert:'Especialista', master:'Mestra' };
const REACTIONS=['👍','😅','🔥','😎','🤔','👏'];

export default function App(){

  const { t, i18n } = useTranslation();
  const [showLangMenu, setShowLangMenu] = useState(false);
  const socket=getSocket();
  const [difficulty,setDifficulty]=useState('easy');
  const [puzzleString,setPuzzleString]=useState('');
  const [solution,setSolution]=useState('');
  const [board,setBoard]=useState([]);
  const [history,setHistory]=useState([]);
  const [notes,setNotes]=useState({});
  const [noteMode,setNoteMode]=useState(false);
  const [selectedCell,setSelectedCell]=useState(null);
  const [errors,setErrors]=useState([]);
  const [mistakeCount,setMistakeCount]=useState(0);
  const [hints,setHints]=useState(MAX_HINTS);
  const [hintsUsed,setHintsUsed]=useState(0);
  const [gameReady,setGameReady]=useState(false);
  const [gameOver,setGameOver]=useState(null);
  const [soundOn,setSoundOn]=useState(true);
  const [timer,setTimer]=useState(0);
  const [paused,setPaused]=useState(false);
  const timerRef=useRef(null);
  const [records,setRecords]=useState(()=>{ try{return JSON.parse(localStorage.getItem('sudoku-records'))||{};}catch{return {};} });
  const [soloMode,setSoloMode]=useState(true);
  const [nickname,setNickname]=useState('');
  const [players,setPlayers]=useState([]);
  const [currentRoomCode,setCurrentRoomCode]=useState('');
  const [roomCodeInput,setRoomCodeInput]=useState('');
  const [waitingForPlayer,setWaitingForPlayer]=useState(false);
  const [showMultiplayer,setShowMultiplayer]=useState(false);
  const [isCreator,setIsCreator]=useState(false);
  const [wins,setWins]=useState({});
  const [progress,setProgress]=useState({});
  const [showRestartDialog,setShowRestartDialog]=useState(false);
  const [chatMessages,setChatMessages]=useState([]);
  const [chatInput,setChatInput]=useState('');
  const [showChat,setShowChat]=useState(false);
  const [unreadChat,setUnreadChat]=useState(0);
  const chatEndRef=useRef(null);

  const sfx=useCallback((name)=>{ if(soundOn)SFX[name]?.(); },[soundOn]);

  const startTimer=useCallback(()=>{ if(timerRef.current)clearInterval(timerRef.current); timerRef.current=setInterval(()=>setTimer(p=>p+1),1000); },[]);
  const stopTimer=useCallback(()=>{ clearInterval(timerRef.current);timerRef.current=null; },[]);
  const togglePause=()=>{ if(!soloMode||gameOver)return; setPaused(p=>{ p?startTimer():stopTimer(); return !p; }); };

  const resetGame=useCallback(()=>{ setSelectedCell(null);setErrors([]);setHistory([]);setNotes({});setNoteMode(false);setMistakeCount(0);setHints(MAX_HINTS);setHintsUsed(0);setGameOver(null);setTimer(0);setPaused(false); },[]);
  const serverDiff=(d)=>({easy:'easy',medium:'medium',hard:'hard',expert:'hard',master:'expert'}[d]||d);
  const startSolo=useCallback((diff)=>{ resetGame();stopTimer();socket.emit('solo-game',{nickname:nickname||'Jogador',difficulty:serverDiff(diff)}); },[nickname,resetGame,stopTimer,socket]);

  useEffect(()=>{ if(!waitingForPlayer&&!currentRoomCode)startSolo(difficulty); },[difficulty]);
  useEffect(()=>{ const code=new URLSearchParams(window.location.search).get('room'); if(code){setRoomCodeInput(code.toUpperCase());setShowMultiplayer(true);} },[]);
  useEffect(()=>{ const s=sessionStorage.getItem('sudoku-room'); if(s){const{roomCode,socketId}=JSON.parse(s);socket.emit('rejoin-room',{roomCode,oldSocketId:socketId});} },[]);
  useEffect(()=>{ if(showChat)chatEndRef.current?.scrollIntoView({behavior:'smooth'}); },[chatMessages,showChat]);
useEffect(() => {
  const handleClickOutside = (e) => {
    if (showLangMenu && !e.target.closest('.lang-flags')) {
      setShowLangMenu(false);
    }
  };
  document.addEventListener('mousedown', handleClickOutside);
  return () => document.removeEventListener('mousedown', handleClickOutside);
}, [showLangMenu]);
  useEffect(()=>{
    const onRoomCreated=({roomCode,isCreator:c})=>{ setCurrentRoomCode(roomCode);setIsCreator(c);setWaitingForPlayer(true);setShowMultiplayer(true);setSoloMode(false);sessionStorage.setItem('sudoku-room',JSON.stringify({roomCode,socketId:socket.id})); };
    const onGameReady=(data)=>{ resetGame();setPuzzleString(data.puzzle);setSolution(data.solution);setBoard(parsePuzzle(data.puzzle));setPlayers(data.players);setSoloMode(false);setShowMultiplayer(false);setWaitingForPlayer(false);setGameReady(true);setIsCreator(data.isCreator);setWins(data.wins||{});setProgress(data.progress||{});setChatMessages(data.chat||[]);if(data.difficulty)setDifficulty(data.difficulty);if(data.roomCode)setCurrentRoomCode(data.roomCode);startTimer(); };
    const onSoloGameReady=(data)=>{ resetGame();setPuzzleString(data.puzzle);setSolution(data.solution);setBoard(parsePuzzle(data.puzzle));setSoloMode(true);setGameReady(true);setCurrentRoomCode('');startTimer(); };
    const onMoveMade=({row,col,value})=>setBoard(prev=>prev.map((r,i)=>r.map((cell,j)=>i===row&&j===col?value:cell)));
    const onProgressUpdate=({progress:prog})=>setProgress(prog);
    const onGameWon=({winnerNickname,wins:nw})=>{ stopTimer();setWins(nw||{});setGameOver({won:winnerNickname===nickname,message:`${winnerNickname} completou!`});sessionStorage.removeItem('sudoku-room'); };
    const onPlayerFinished=({nickname:wn,time,wins:nw})=>{ stopTimer();if(nw)setWins(nw);setGameOver({won:false,message:`${wn} venceu em ${formatTime(time)}!`});sessionStorage.removeItem('sudoku-room'); };
    const onPlayerLeft=()=>{ stopTimer();setGameOver({won:true,message:t('gameover.opponent_left')});setSoloMode(true);setCurrentRoomCode('');sessionStorage.removeItem('sudoku-room'); };
    const onHintResponse=({row,col,value})=>{ setBoard(prev=>prev.map((r,i)=>r.map((cell,j)=>i===row&&j===col?value:cell)));setNotes(prev=>{const n={...prev};delete n[`${row}-${col}`];return n;}); };
    const onChatMsg=(msg)=>{ setChatMessages(prev=>[...prev,msg]);if(!showChat)setUnreadChat(p=>p+1); };
    const onError=(msg)=>alert(msg);
    socket.on('room-created',onRoomCreated);socket.on('game-ready',onGameReady);socket.on('solo-game-ready',onSoloGameReady);socket.on('move-made',onMoveMade);socket.on('progress-update',onProgressUpdate);socket.on('game-won',onGameWon);socket.on('player-finished',onPlayerFinished);socket.on('player-left',onPlayerLeft);socket.on('hint-response',onHintResponse);socket.on('chat-message',onChatMsg);socket.on('error',onError);
    return ()=>{ socket.off('room-created',onRoomCreated);socket.off('game-ready',onGameReady);socket.off('solo-game-ready',onSoloGameReady);socket.off('move-made',onMoveMade);socket.off('progress-update',onProgressUpdate);socket.off('game-won',onGameWon);socket.off('player-finished',onPlayerFinished);socket.off('player-left',onPlayerLeft);socket.off('hint-response',onHintResponse);socket.off('chat-message',onChatMsg);socket.off('error',onError); };
  },[resetGame,startTimer,stopTimer,showChat,nickname,t]);

  useEffect(()=>{
    if(!soloMode||!gameReady||gameOver||!solution||!board.length)return;
    if(isSolved(board,solution)){ stopTimer();const nr={...records,[difficulty]:Math.min(timer,records[difficulty]??Infinity)};setRecords(nr);localStorage.setItem('sudoku-records',JSON.stringify(nr));setGameOver({won:true,message:t('gameover.win_solo')});sfx('win');fireConfetti(); }
  },[board]);

  const updateCell=useCallback((value)=>{
    if(!selectedCell||gameOver||paused)return;
    const{row,col}=selectedCell;
    if(isFixed(puzzleString,row,col))return;
    if(noteMode&&value!==0){ sfx('note');setNotes(prev=>{ const key=`${row}-${col}`,set=new Set(prev[key]||[]); set.has(value)?set.delete(value):set.add(value); return{...prev,[key]:set}; });return; }
    setHistory(prev=>[...prev.slice(-29),{board:board.map(r=>[...r]),errors:[...errors],notes:{...notes}}]);
    const nb=board.map((r,i)=>r.map((cell,j)=>i===row&&j===col?value:cell));
    setBoard(nb);setNotes(prev=>{const n={...prev};delete n[`${row}-${col}`];return n;});setErrors(value!==0?getConflicts(nb,row,col,value):[]);
    if(value!==0&&solution&&soloMode){ const correct=parseInt(solution[row*9+col]); if(value!==correct){ sfx('error');setMistakeCount(m=>m+1); if(mistakeCount+1>=3){stopTimer();sfx('lose');setGameOver({won:false,message:t('gameover.lose_errors')});} }else sfx('click'); }else if(value!==0)sfx('click');
    if(!soloMode&&currentRoomCode)socket.emit('make-move',{roomCode:currentRoomCode,row,col,value});
  },[selectedCell,gameOver,paused,puzzleString,noteMode,board,errors,notes,solution,soloMode,currentRoomCode,mistakeCount,stopTimer,sfx,socket,t]);

  const undo=useCallback(()=>{ if(!history.length||gameOver)return; sfx('undo');const last=history[history.length-1];setBoard(last.board);setErrors(last.errors);setNotes(last.notes);setHistory(prev=>prev.slice(0,-1)); },[history,gameOver,sfx]);

  const useHint=useCallback(()=>{
    if(!selectedCell||hints<=0||gameOver||!solution)return;
    const{row,col}=selectedCell;if(isFixed(puzzleString,row,col))return;
    const value=parseInt(solution[row*9+col]);sfx('hint');setHints(h=>h-1);setHintsUsed(h=>h+1);
    setHistory(prev=>[...prev.slice(-29),{board:board.map(r=>[...r]),errors:[...errors],notes:{...notes}}]);
    setBoard(prev=>prev.map((r,i)=>r.map((cell,j)=>i===row&&j===col?value:cell)));
    setNotes(prev=>{const n={...prev};delete n[`${row}-${col}`];return n;});setErrors([]);
    if(!soloMode&&currentRoomCode)socket.emit('request-hint',{roomCode:currentRoomCode,row,col});
  },[selectedCell,hints,gameOver,solution,puzzleString,board,errors,notes,soloMode,currentRoomCode,sfx,socket]);

  const moveCell=useCallback((dr,dc)=>{ setSelectedCell(prev=>{ if(!prev)return{row:0,col:0}; return{row:Math.max(0,Math.min(8,prev.row+dr)),col:Math.max(0,Math.min(8,prev.col+dc))}; }); },[]);

  const createRoom=()=>{ if(!nickname.trim())return alert('Escolha um apelido!');socket.emit('create-room',{nickname:nickname.trim(),difficulty:serverDiff(difficulty)}); };
  const joinRoom=()=>{ if(!nickname.trim())return alert('Escolha um apelido!');if(!roomCodeInput.trim())return alert('Digite o código!');socket.emit('join-room',{roomCode:roomCodeInput.trim().toUpperCase(),nickname}); };
  const finishGame=()=>{ if(!soloMode&&currentRoomCode)socket.emit('finish-game',{roomCode:currentRoomCode,time:timer}); };
  const restartRoom=(diff)=>{ if(currentRoomCode){socket.emit('restart-room',{roomCode:currentRoomCode,difficulty:serverDiff(diff||difficulty)});setShowRestartDialog(false);} };
  const shareLink=()=>{ const url=`${window.location.origin}${window.location.pathname}?room=${currentRoomCode}`;if(navigator.share)navigator.share({title:'Sudoku Online',url});else{navigator.clipboard.writeText(url);alert('Link copiado!');} };
  const sendChat=(text)=>{ if(!text.trim()||!currentRoomCode)return;socket.emit('chat-message',{roomCode:currentRoomCode,text:text.trim()});setChatInput(''); };

  const remaining=countRemaining(board);
  const maxMistakes=3;

  if(!gameReady)return <div className="loading-screen">{t('app.loading')}</div>;

  const SidePanel = (
    <div className="side-panel">

      {/* Info: erros + tempo (desktop) */}
      <div className="side-info">
        <div className="info-errors">
          <span className="info-errors-label">{t('info.errors')}</span>
          <span className="info-errors-val">
            <span>{mistakeCount}</span>/{maxMistakes}
          </span>
        </div>
        <div className="info-time-block">
          <span className="info-time-label">{t('info.time')}</span>
          <div className="info-timer">
            {formatTime(timer)}
            {soloMode&&(
              <button className="btn-pause" onClick={togglePause} title={paused?t('actions.resume'):t('actions.pause')}>
                {paused ? <CirclePlay size={16} strokeWidth={2.5} /> : <CirclePause size={16} strokeWidth={2.5} />}
              </button>
            )}
          </div>
          {records[difficulty]!=null&&(
            <span className="info-record">
              <Trophy size={14} strokeWidth={2.5} style={{marginRight:4}} />
              {formatTime(records[difficulty])}
            </span>
          )}
        </div>
      </div>

      {/* Toolbar circular */}
      <div className="side-toolbar-row">
        <button className="btn-tool-circle" onClick={undo} disabled={!history.length||!!gameOver} title={t('toolbar.undo')}>
          <div className="btn-tool-circle-icon">
            <Undo2 size={20} strokeWidth={2.2} />
          </div>
          <span className="btn-tool-circle-label">{t('toolbar.undo')}</span>
        </button>

        <button className="btn-tool-circle" onClick={()=>updateCell(0)} disabled={!!gameOver||paused} title={t('toolbar.erase')}>
          <div className="btn-tool-circle-icon">
            <Trash2 size={19} strokeWidth={2.2} />
          </div>
          <span className="btn-tool-circle-label">{t('toolbar.erase')}</span>
        </button>

        <button className={`btn-tool-circle${noteMode?' btn-tool-circle--active':''}`} onClick={()=>setNoteMode(v=>!v)} disabled={!!gameOver} title={t('toolbar.pencil')}>
          <div className="btn-tool-circle-icon">
            <PenLine size={19} strokeWidth={2.2} />
            <span className="btn-tool-badge btn-tool-badge--off">{noteMode?t('toolbar.pencil_on'):t('toolbar.pencil_off')}</span>
          </div>
          <span className="btn-tool-circle-label">{t('toolbar.pencil')}</span>
        </button>

        <button className="btn-tool-circle" onClick={useHint} disabled={hints<=0||!!gameOver||!selectedCell} title={t('toolbar.hint')}>
          <div className="btn-tool-circle-icon">
            <Lightbulb size={20} strokeWidth={2.2} />
            {hints>0&&<span className="btn-tool-badge">{hints}</span>}
          </div>
          <span className="btn-tool-circle-label">{t('toolbar.hint')}</span>
        </button>
      </div>

      {/* Numpad 3×3 */}
      <div className="side-numpad">
        {[1,2,3,4,5,6,7,8,9].map(n=>(
          <button key={n}
            className={`btn-num${noteMode?' btn-num--note':''}${remaining[n]===0?' btn-num--done':''}`}
            onClick={()=>updateCell(n)} disabled={!!gameOver||paused}>{n}</button>
        ))}
      </div>

      {/* Contador restantes */}
      {soloMode&&!gameOver&&(
        <div className="side-counter">
          {[1,2,3,4,5,6,7,8,9].map(n=>(
            <div key={n} className={`num-count-item${remaining[n]===0?' num-count-item--done':''}`}>
              <span className="num-count-digit">{n}</span>
              <span className="num-count-left">{remaining[n]>0?remaining[n]:'✓'}</span>
            </div>
          ))}
        </div>
      )}

      {/* Botão Novo Jogo / Som / Concluí */}
      {soloMode?(
        <button className="btn-new-game" onClick={()=>startSolo(difficulty)}>{t('actions.new_game')}</button>
      ):(
        <button className="btn-new-game" onClick={finishGame} disabled={!!gameOver}>{t('actions.finish')}</button>
      )}

      {/* Som (discreto) */}
      <button className="btn-ghost" style={{width:'100%',textAlign:'center',fontSize:12}} onClick={()=>setSoundOn(v=>!v)}>
        {soundOn?t('actions.sound_on'):t('actions.sound_off')}
      </button>

      {/* Multiplayer: revanche */}
      {!soloMode&&isCreator&&gameOver&&(
        <button className="btn-ghost" style={{width:'100%',textAlign:'center'}} onClick={()=>setShowRestartDialog(true)}>{t('actions.rematch')}</button>
      )}
    </div>
  );

  return (
    <div className="app">

      {/* Header */}
      <header className="header">
        <div className="header-left">
          <span className="logo">数独</span>
          <div style={{display:'flex',flexDirection:'column'}}>
            <span className="logo-text">Sudoku</span>
            <span className="logo-subtitle">{t('app.subtitle')}</span>
          </div>
        </div>
        <div className="header-right">
          <input className="input-nickname" placeholder={t('header.nickname')} value={nickname} onChange={e=>setNickname(e.target.value)}/>
          <button className="btn-ghost" onClick={()=>setShowMultiplayer(v=>!v)}>
            {showMultiplayer ? t('header.close') : <><Users size={18} strokeWidth={2} style={{marginRight:6}} />{t('header.multi')}</>}
          </button>
        </div>
        
       {/* Seletor de idioma */}
<div className="lang-flags" style={{ position: 'relative' }}>
  <button
    onClick={() => setShowLangMenu(v => !v)}
    style={{
      background: 'none',
      border: '1.5px solid var(--clr-border)',
      borderRadius: 6,
      padding: '4px 8px',
      fontSize: 18,
      cursor: 'pointer',
      lineHeight: 1,
      color: 'var(--clr-text-1)',
    }}
    title="Idioma"
  >
    🌐
  </button>
  {showLangMenu && (
    <div
      style={{
        position: 'absolute',
        top: '100%',
        right: 0,
        marginTop: 6,
        background: 'var(--clr-surface)',
        border: '1.5px solid var(--clr-border)',
        borderRadius: 8,
        boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
        zIndex: 100,
        padding: '4px 0',
        minWidth: 140,
      }}
    >
      {[
        { code: 'pt', label: '🇧🇷 Português' },
        { code: 'en', label: '🇺🇸 English' },
        { code: 'es', label: '🇪🇸 Español' },
        { code: 'zh', label: '🇨🇳 中文' },
        { code: 'ja', label: '🇯🇵 日本語' },
        { code: 'hi', label: '🇮🇳 हिन्दी' },
        { code: 'de', label: '🇩🇪 Deutsch' },
      ].map(({ code, label }) => (
        <button
          key={code}
          onClick={() => {
                   
            i18n.changeLanguage(code);
            setShowLangMenu(false);
          }}
          style={{
            display: 'block',
            width: '100%',
            background: 'none',
            border: 'none',
            padding: '8px 14px',
            textAlign: 'left',
            fontSize: 13,
            cursor: 'pointer',
            color: 'var(--clr-text-1)',
          }}
          onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--clr-surface-2)')}
          onMouseLeave={(e) => (e.currentTarget.style.background = 'none')}
        >
          {label}
        </button>
      ))}
    </div>
  )}
</div>
      </header>

      {/* Multiplayer panel */}
      {showMultiplayer&&(
        <div className="mp-panel">
          {!waitingForPlayer?(
            <div className="mp-sections">
              <div className="mp-section">
                <span className="mp-label">{t('multiplayer.create_room')}</span>
                <div className="mp-row">
                  <button className="btn-primary" onClick={createRoom}>{t('multiplayer.create_btn')}</button>
                  {currentRoomCode&&<span className="room-code">{currentRoomCode}</span>}
                </div>
              </div>
              <div className="mp-divider"/>
              <div className="mp-section">
                <span className="mp-label">{t('multiplayer.join_room')}</span>
                <div className="mp-row">
                  <input className="input-code" placeholder={t('multiplayer.code_label')} value={roomCodeInput} onChange={e=>setRoomCodeInput(e.target.value.toUpperCase())} maxLength={6}/>
                  <button className="btn-primary" onClick={joinRoom}>{t('multiplayer.enter_btn')}</button>
                </div>
              </div>
            </div>
          ):(
            <div className="mp-waiting">
              <div className="mp-waiting-info">
                <span className="mp-label">{t('multiplayer.code_label')}</span>
                <span className="room-code room-code--lg">{currentRoomCode}</span>
              </div>
              <div className="mp-waiting-actions">
                <button className="btn-primary" onClick={shareLink}>
                  <Share2 size={16} strokeWidth={2.5} style={{marginRight:6}} />
                  {t('multiplayer.share_link')}
                </button>
                <button className="btn-ghost" onClick={()=>{navigator.clipboard.writeText(currentRoomCode);alert(t('multiplayer.copied'));}}>
                  <Clipboard size={16} strokeWidth={2.5} style={{marginRight:6}} />
                  {t('multiplayer.copy_code')}
                </button>
              </div>
              <span className="mp-waiting-status">
                <Hourglass size={14} strokeWidth={2.5} style={{marginRight:4}} />
                {t('multiplayer.waiting')}
              </span>
            </div>
          )}
        </div>
      )}

      {waitingForPlayer&&currentRoomCode&&!showMultiplayer&&(
        <div className="room-code-bar">
          <span>{t('multiplayer.room_bar_title')} <strong>{currentRoomCode}</strong></span>
          <button onClick={shareLink}>
            <Share2 size={16} strokeWidth={2.5} style={{marginRight:6}} />
            {t('multiplayer.share_link')}
          </button>
          <span>
            <Hourglass size={14} strokeWidth={2.5} style={{marginRight:4}} />
            {t('multiplayer.room_bar_waiting')}
          </span>
        </div>
      )}

      {/* Dificuldade + info mobile */}
      {soloMode && !waitingForPlayer && !gameOver && (
        <div className="difficulty-bar">
          <span className="diff-label">{t('difficulty.label')}</span>

          {/* Versão desktop (botões) */}
          <div className="difficulty-desktop">
            {Object.entries(DIFF_LABELS).map(([key, label]) => (
              <button
                key={key}
                className={`btn-diff${difficulty === key ? ' active' : ''}`}
                onClick={() => setDifficulty(key)}
              >
                {t(`difficulty.${key}`)}
              </button>
            ))}
          </div>

          {/* Versão mobile (select nativo) */}
          <select
            className="difficulty-select"
            value={difficulty}
            onChange={(e) => setDifficulty(e.target.value)}
          >
            {Object.entries(DIFF_LABELS).map(([key, label]) => (
              <option key={key} value={key}>{t(`difficulty.${key}`)}</option>
            ))}
          </select>

          {/* Info mobile (erros + tempo) – DEPOIS do select */}
          <div className="side-info side-info--mobile">
            <div className="info-errors">
              <span className="info-errors-label">{t('info.errors')}</span>
              <span className="info-errors-val">
                <span>{mistakeCount}</span>/{maxMistakes}
              </span>
            </div>
            <div className="info-time-block">
              <span className="info-time-label">{t('info.time')}</span>
              <div className="info-timer">
                {formatTime(timer)}
                {soloMode && (
                  <button className="btn-pause" onClick={togglePause} title={paused?t('actions.resume'):t('actions.pause')}>
                    {paused ? <CirclePlay size={16} strokeWidth={2.5} /> : <CirclePause size={16} strokeWidth={2.5} />}
                  </button>
                )}
              </div>
              {records[difficulty]!=null && (
                <span className="info-record">
                  <Trophy size={14} strokeWidth={2.5} style={{marginRight:4}} />
                  {formatTime(records[difficulty])}
                </span>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Progresso multiplayer */}
      {!soloMode&&players.length===2&&(
        <div className="mp-progress-panel">
          {players.map(p=>(
            <div key={p.id} className="mp-progress-row">
              <span className="mp-progress-name">{p.nickname}</span>
              <div className="mp-progress-track"><div className="mp-progress-fill" style={{width:`${Math.round(((progress[p.id]||0)/81)*100)}%`}}/></div>
              <span className="mp-progress-pct">{Math.round(((progress[p.id]||0)/81)*100)}%</span>
            </div>
          ))}
          <div className="mp-score-inline">
            <span>{players[0]?.nickname}</span>
            <strong>
              <Trophy size={16} strokeWidth={2.5} style={{marginRight:4}} />
              {wins[players[0]?.id]||0} × {wins[players[1]?.id]||0}
              <Trophy size={16} strokeWidth={2.5} style={{marginLeft:4}} />
            </strong>
            <span>{players[1]?.nickname}</span>
          </div>
        </div>
      )}

      {/* Layout principal */}
      <div className="game-layout">
        <div className="board-wrapper">
          {paused&&<div className="pause-overlay"><span>⏸ Pausado — {t('actions.resume')}</span></div>}
          {gameOver&&(
            <div className="gameover-overlay">
              <div className="gameover-card">
                <p className="gameover-msg">
                  {gameOver.won ? (
                    <PartyPopper size={24} strokeWidth={2.5} style={{marginRight:8,verticalAlign:'middle'}} />
                  ) : (
                    <Skull size={24} strokeWidth={2.5} style={{marginRight:8,verticalAlign:'middle'}} />
                  )}
                  {gameOver.message}
                </p>
                {soloMode&&gameOver.won&&(
                  <div className="stats-grid">
                    <div className="stat-item"><span className="stat-value">{formatTime(timer)}</span><span className="stat-label">{t('gameover.stats_time')}</span></div>
                    <div className="stat-item"><span className="stat-value">{mistakeCount}</span><span className="stat-label">{t('gameover.stats_errors')}</span></div>
                    <div className="stat-item"><span className="stat-value">{hintsUsed}</span><span className="stat-label">{t('gameover.stats_hints')}</span></div>
                    {records[difficulty]&&<div className="stat-item"><span className="stat-value">{formatTime(records[difficulty])}</span><span className="stat-label">{t('gameover.stats_best')}</span></div>}
                  </div>
                )}
                <button className="btn-new-game" style={{marginTop:4}} onClick={()=>startSolo(difficulty)}>{t('actions.new_game')}</button>
              </div>
            </div>
          )}
          <Board board={board} puzzleString={puzzleString} notes={notes} selectedCell={selectedCell} errors={errors}
            onSelectCell={cell=>{if(!gameOver&&!paused)setSelectedCell(cell);}}
            updateCell={updateCell} undo={undo} clearSelection={()=>setSelectedCell(null)} moveCell={moveCell}/>
        </div>
        {SidePanel}
      </div>

      {/* Chat */}
      {!soloMode&&(
        <div className="chat-wrapper">
          <button className="btn-chat-toggle" onClick={()=>{setShowChat(v=>!v);setUnreadChat(0);}}>
            <MessageCircle size={18} strokeWidth={2.5} style={{marginRight:8}} />
            {t('chat.toggle')} {unreadChat>0&&<span className="chat-badge">{unreadChat}</span>}
          </button>
          {showChat&&(
            <div className="chat-panel">
              <div className="chat-messages">
                {chatMessages.length===0&&<span style={{color:'var(--clr-text-3)',fontSize:13}}>{t('chat.empty')}</span>}
                {chatMessages.map((m,i)=>(
                  <div key={i} className="chat-msg"><span className="chat-nick">{m.nickname}:</span><span className="chat-text">{m.text}</span></div>
                ))}
                <div ref={chatEndRef}/>
              </div>
              <div className="chat-reactions">{REACTIONS.map(r=><button key={r} className="btn-reaction" onClick={()=>sendChat(r)}>{r}</button>)}</div>
              <div className="chat-input-row">
                <input className="chat-input" placeholder={t('chat.placeholder')} value={chatInput} onChange={e=>setChatInput(e.target.value)} onKeyDown={e=>e.key==='Enter'&&sendChat(chatInput)}/>
                <button className="btn-primary" onClick={()=>sendChat(chatInput)}>→</button>
              </div>
            </div>
          )}
        </div>
      )}

      {showRestartDialog&&(
        <div className="restart-dialog-overlay">
          <div className="restart-dialog">
            <h3>{t('restart.title')}</h3>
            <p>{t('restart.text')}</p>
            <label>{t('restart.label')}
              <select value={difficulty} onChange={e=>setDifficulty(e.target.value)}>
                {Object.entries(DIFF_LABELS).map(([k,v])=><option key={k} value={k}>{t(`difficulty.${k}`)}</option>)}
              </select>
            </label>
            <div className="restart-dialog-buttons">
              <button className="btn-primary" onClick={()=>restartRoom(difficulty)}>{t('restart.confirm')}</button>
              <button className="btn-ghost" onClick={()=>setShowRestartDialog(false)}>{t('restart.cancel')}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Board({board,puzzleString,notes,selectedCell,errors,onSelectCell,updateCell,undo,clearSelection,moveCell}){
  const handleKey=useCallback(e=>{
    if(e.key>='1'&&e.key<='9')updateCell(parseInt(e.key));
    else if(e.key==='Backspace'||e.key==='Delete')updateCell(0);
    else if(e.key==='Escape')clearSelection();
    else if((e.ctrlKey||e.metaKey)&&e.key==='z'){e.preventDefault();undo();}
    else if(e.key==='ArrowUp'){e.preventDefault();moveCell(-1,0);}
    else if(e.key==='ArrowDown'){e.preventDefault();moveCell(1,0);}
    else if(e.key==='ArrowLeft'){e.preventDefault();moveCell(0,-1);}
    else if(e.key==='ArrowRight'){e.preventDefault();moveCell(0,1);}
  },[updateCell,clearSelection,undo,moveCell]);
  useEffect(()=>{ window.addEventListener('keydown',handleKey);return()=>window.removeEventListener('keydown',handleKey); },[handleKey]);
  const selectedVal=selectedCell?board[selectedCell.row]?.[selectedCell.col]:0;
  const isHighlighted=(r,c)=>{ if(!selectedCell)return false; const{row:sr,col:sc}=selectedCell; return r===sr||c===sc||(Math.floor(r/3)===Math.floor(sr/3)&&Math.floor(c/3)===Math.floor(sc/3)); };
  return(
    <div className="board">
      {board.map((row,r)=>(
        <div key={r} className={`board-row${r%3===2&&r!==8?' board-row--thick-bottom':''}`}>
          {row.map((val,c)=>{
            const fixed=isFixed(puzzleString,r,c),sel=selectedCell?.row===r&&selectedCell?.col===c;
            const err=errors.includes(`${r}-${c}`),hl=isHighlighted(r,c);
            const sameVal=selectedVal&&selectedVal!==0&&val===selectedVal&&!sel;
            const cellNotes=notes[`${r}-${c}`];
            return(
              <div key={c} className={['cell',fixed&&'cell--fixed',sel&&'cell--selected',err&&'cell--error',hl&&!sel&&!sameVal&&'cell--highlight',sameVal&&'cell--same-value',c%3===2&&c!==8&&'cell--thick-right'].filter(Boolean).join(' ')}
                onClick={()=>onSelectCell({row:r,col:c})}>
                {val!==0?<span className="cell-value">{val}</span>
                  :cellNotes?.size>0?<div className="cell-notes">{[1,2,3,4,5,6,7,8,9].map(n=><span key={n} className={`note${cellNotes.has(n)?' note--on':''}`}>{n}</span>)}</div>
                  :null}
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}