import { useCallback, useEffect, useRef, useState } from 'react';
import { fabric } from 'fabric';
import { collection, doc, getDocs, query, onSnapshot, updateDoc, where, getDoc, runTransaction } from 'firebase/firestore';
import { db } from '@/config/firebase';
import { useWallet } from '@aptos-labs/wallet-adapter-react';
import * as Ably from 'ably';
// import { fabricGif, FabricGifImage } from './utils/fabricGif';
import { changePlayerSVG, setupArena, setupDecorativeElements } from './components/ElementGame';
import GameCounter from './components/GameCounter';
import { notificateStore } from '@/store/notificateStore';
import WonOrLostModal from './components/WonOrLostModal';
import { ABLY_KEY } from "@/constants";


interface Player {
  id: string;
  x: number;
  y: number;
  angle:number;
  color: string;
  hasDynamite: boolean;
  isDead: boolean;
  wallet: string;
}

interface GameState {
  players: Player[];
  dynamiteHolder: string | null;
  explosionTime: number;
  winner:string|null;
  isStart:boolean;
  winnerWallet:string;
  status: string;
  roomIdContract: number;
  totalPlayers: number;
  isBettingRoom: boolean;
  betAmount:any;
  playersWallets:string[]
}

const COLORS = ['red', 'blue', 'green', 'yellow', 'purple', 'orange', 'pink', 'cyan'];
// const MAX_PLAYERS = 2;
const ARENA_RADIUS = 180;
const PLAYER_RADIUS = 16;

// roomId G4wc5hMBwefzX3r6bJ0W
// chanel game-1726685339198 game-${Date.now()}

 export function DinamiteGame() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [canvas, setCanvas] = useState<fabric.Canvas | null>(null);
  const [gameState, setGameState] = useState<GameState>();
  const [playerId, setPlayerId] = useState<string | null>(null);
  const [ably, setAbly] = useState<Ably.Realtime | null>(null);
  const [channel, setChannel] = useState<Ably.RealtimeChannel | null>(null);
  const gameStateRef = useRef<any>(null);
  const gifref = useRef<any>(null);
  const startCountRef = useRef<any>(0);
  const [showCounter, setShowCounter] = useState(false);
  const { currentRoom } = notificateStore();
  const [isModalOpen, setModalOpen] = useState(false);
  const [statusContractGame, setStatusContractGame] = useState('');
  const [isWon, setIsWon] = useState(false);
  const [isPlayEnd, setIsPlayEnd] = useState(false);
  const [wonAmount, setWonAmount] = useState(0);
  const playGameAfterStart = useRef(false);
  const explosionTimeoutRef = useRef<any>(null);
  const startDynamitePassingTimeoutRef = useRef<any>(null);
  //const { selectedGame, setNotifyCurrentRoom, setIsSpectator } = notificateStore();
  const { setNotifyCurrentRoom, setIsSpectator } = notificateStore();

  const { account } = useWallet();

  
  useEffect(() => {
    
    gameStateRef.current = gameState;
    if (gameState?.winner) {
      playGameAfterStart.current=false
      let amount = parseFloat(gameState?.betAmount)
      amount = amount * gameState.totalPlayers
      setWonAmount(amount)
      setIsWon(gameState?.winnerWallet === account?.address)
      let statusGame = `${gameState.winner}winner`
      setStatusContractGame(statusGame)
      setIsPlayEnd(true)
      //setShowWinnerAlert(true);
      setModalOpen(true)
    }else{

      let playerStatus = gameState?.players.find(p=> p.wallet === account?.address)

      if(gameState && playerStatus && playerStatus.isDead){
        setIsWon(false)
        setIsPlayEnd(false)
        setModalOpen(true)
      }

      // console.log(gameState)
      if(gameState?.isStart && gameState.winner!='' && gameState.status==="live" && !playerStatus?.isDead){
        playGameAfterStart.current = true
      }

    }

    
    
    // fabricGif(
    //   "/images/flame.gif",
    //   100,
    //   100
    // ).then((vl)=>{
    //   let gif = vl as FabricGifImage
    //   if(gifref.current>2) return
    //     gifref.current+=1
    //     gif.set({ top: 290, left: 260 });
    //     gif.play()
    //     canvas?.add(gif)
    //     canvas?.renderAll();
        
    // })
  
    // fabric.util.requestAnimFrame(function render() {
    //   canvas?.renderAll();
    //   fabric.util.requestAnimFrame(render);
    // }); 
  }, [gameState, currentRoom]);

  useEffect(() => {
    if (account?.address) {
      if(gifref.current==1) return
        gifref.current+=1
      initializeGame();
    }
    
    return () => {
      if (canvas) {
        canvas.dispose();
      }
      if (channel) {
        channel.unsubscribe();
      }
      if (ably) {
        ably.close();
      }
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [account?.address]);

  const handleKeyDown = useCallback(async (e: KeyboardEvent) => {
    if (!playerId || !canvas || !currentRoom) return;
    // console.log(playGameAfterStart.current)
    
    if(!playGameAfterStart.current) return
    
    const player = gameState?.players.find((p:any) => p.id === playerId);
    if (!player) return;
    
    let newX = player.x;
    let newY = player.y;
    let angle = player.angle || 0;
    
    const speed = 20;
    
    switch (e.key) {
      case 'ArrowUp': 
        newY -= speed; 
        angle = 270; // 270 grados
        break;
      case 'ArrowDown': 
        newY += speed; 
        angle = 90; // 90 grados
        break;
      case 'ArrowLeft': 
        newX -= speed; 
        angle = 180; // 180 grados
        break;
      case 'ArrowRight': 
        newX += speed; 
        angle = 0; // 0 grados
        break;
      default: return;
    }
    
    e.preventDefault();
    
    const centerX = 200;
    const centerY = 200;
    
    const distanceFromCenter = Math.sqrt(Math.pow(newX - centerX, 2) + Math.pow(newY - centerY, 2));
    if (distanceFromCenter > 160) {
      const angleToCenter = Math.atan2(newY - centerY, newX - centerX);
      newX = centerX + 160 * Math.cos(angleToCenter);
      newY = centerY + 160 * Math.sin(angleToCenter);
    }

    const collidedPlayer = gameState?.players.find((p:any) => 
      p.id !== playerId && !p.isDead &&
      Math.sqrt(Math.pow(p.x - newX, 2) + Math.pow(p.y - newY, 2)) < PLAYER_RADIUS * 2
    );

    if (collidedPlayer) {
      // Calculate push direction
      const pushAngle = Math.atan2(collidedPlayer.y - newY, collidedPlayer.x - newX);
      const pushDistance = PLAYER_RADIUS * 2 - Math.sqrt(Math.pow(collidedPlayer.x - newX, 2) + Math.pow(collidedPlayer.y - newY, 2));
      
      // Push both players apart
      newX -= Math.cos(pushAngle) * pushDistance / 0.5;
      newY -= Math.sin(pushAngle) * pushDistance / 0.5;
      
      const newCollidedX = collidedPlayer.x + Math.cos(pushAngle) * pushDistance / 0.5;
      const newCollidedY = collidedPlayer.y + Math.sin(pushAngle) * pushDistance / 0.5;
      
      // Pass dynamite if necessary
      // if (player.hasDynamite && !collidedPlayer.hasDynamite) {
      //   updateDynamiteHolder(collidedPlayer.id);
      // }

      setGameState((prevState:any) => ({
        ...prevState,
        players: prevState.players.map((p:any) =>
          p.id === collidedPlayer.id ? { ...p, x: newCollidedX, y: newCollidedY, angle: collidedPlayer.angle } : p
        )
      }));
      
      // Update collided player position
      if (channel) {
       await channel.publish('playerMove', { id: collidedPlayer.id, x: newCollidedX, y: newCollidedY, angle: collidedPlayer.angle });
      }

      //Deuda tecnica, se debe actualizar por ably y no por firebase
      if (player.hasDynamite) {
        // console.log("tengo la dinamita")
        updateDynamiteHolder(collidedPlayer.id);
      } else if (collidedPlayer.hasDynamite) {
        // console.log("otro tiene la dinamita")
        updateDynamiteHolder(playerId!);
      }
      
    }else{
      setGameState((prevState:any) => ({
        ...prevState,
        players: prevState.players.map((p:any) =>
          p.id === playerId ? { ...p, x: newX, y: newY, angle: angle } : p
        )
      }));
      
      if (channel) {
        await channel.publish('playerMove', { id: playerId, x: newX, y: newY, angle: angle });
      }
    }
  }, [playerId, canvas, gameState, channel]);

  useEffect(() => {
    if (canvas && playerId) {
      window.addEventListener('keydown', handleKeyDown);
      return () => {
        window.removeEventListener('keydown', handleKeyDown);
      };
    }
  }, [canvas, playerId, handleKeyDown, playGameAfterStart]);

  const initializeGame = async () => {
    //para que no se instancie muchos veces

    if (!account?.address || !canvasRef.current || !currentRoom) return;
    
    const fabricCanvas = new fabric.Canvas(canvasRef.current, {
      width: 400,
      height: 400,
      selection: false,
      hoverCursor: 'auto',
      defaultCursor: 'default',
      renderOnAddRemove: false,
      skipTargetFind: true,
      interactive: false,
      stopContextMenu:true,
      preserveObjectStacking:true
    });
  
    fabricCanvas.off('mouse:down');
    fabricCanvas.off('mouse:up');
    fabricCanvas.off('mouse:move');
  
    setCanvas(fabricCanvas);

    const ablyInstance = new Ably.Realtime({ key: ABLY_KEY });
    
    setAbly(ablyInstance);

    await joinGame();

    const gameRef = doc(db, 'games_ably', currentRoom);

    const gamDoc = await getDoc(gameRef)
    
    onSnapshot(gameRef, async (snapshot) => {
      const newGameState = snapshot.data() as GameState;
      if (newGameState) {

        if (gameStateRef.current) {
          newGameState.players = newGameState.players.map(newPlayer => {
            const currentPlayer = gameStateRef.current.players.find(
              (p: any) => p.id === newPlayer.id
            );
            if (currentPlayer) {
              return {
                ...newPlayer,
                x: currentPlayer.x,
                y: currentPlayer.y,
                angle:currentPlayer.angle
              };
            }
            return newPlayer;
          });
        }
        if(newGameState.players.length == newGameState.totalPlayers && startCountRef.current<1){
          startCountRef.current+=1
          await updateDoc(snapshot.ref, {isStart:!newGameState.isStart, status:"live"})
          setShowCounter(true);
        }
      
        setGameState(newGameState);
        updateCanvas(fabricCanvas, newGameState);
      }
    });

    const gameData = gamDoc.data()
    const gameChannel = ablyInstance.channels.get(gameData?.channel);
    setChannel(gameChannel);

    gameChannel.subscribe('playerMove', (message) => {
      const { id, x, y, angle } = message.data;
      updatePlayerPosition(fabricCanvas, id, x, y, angle, gameStateRef.current, setGameState);
    });

    setupArena(fabricCanvas, ARENA_RADIUS);
    setupDecorativeElements(fabricCanvas);

    fabricCanvas.requestRenderAll();
     // Start dynamite passing loop
     
  };

  // const joinGame = async () => {
  //   if (!account?.address) return;

  //   try {
  //     const playerQuery = query(collection(db, 'players'), where('wallet', '==', account.address));
  //     const playerSnapshot = await getDocs(playerQuery);
      
  //     let playerId = playerSnapshot.docs[0].id
  //     setPlayerId(playerSnapshot.docs[0].id);
      
  //     const gameRef = doc(db, 'games_ably', currentRoom!);
  //     const gameDoc = await getDoc(gameRef);

  //     if (gameDoc.exists()) {
  //       const currentGame = gameDoc.data() as GameState;
  //       const existingPlayer = currentGame.players.find(p => p.id === playerId);

  //       if (!existingPlayer && currentGame.players.length < currentGame.totalPlayers) {
  //         const playerIndex = currentGame.players.length;
  //         const angleStep = (2 * Math.PI) / currentGame.totalPlayers;
  //         const angle = playerIndex * angleStep;
          
  //         // Calculamos el ángulo de rotación del jugador
  //         let rotationAngle = (angle + Math.PI) % (2 * Math.PI);
          
  //         // Convertimos el ángulo de rotación a grados
  //         let rotationAngleDegrees = (rotationAngle * 180) / Math.PI;

  //         const newPlayer: Player = {
  //           id: playerId!,
  //           x: ARENA_RADIUS * Math.cos(angle) + 200,
  //           y: ARENA_RADIUS * Math.sin(angle) + 200,
  //           angle: rotationAngleDegrees,
  //           color: COLORS[currentGame.players.length],
  //           hasDynamite: false,//currentGame.players.length === 0
  //           isDead:false,
  //           wallet: account?.address
  //         };
  //         const updatedPlayers = [...currentGame.players, newPlayer];
  //         await updateDoc(gameRef, { 
  //           players: updatedPlayers,
  //           dynamiteHolder: currentGame.players.length === 0 ? playerId : currentGame.dynamiteHolder,
  //           playersWallets: [...currentGame.playersWallets, account?.address]
  //         });

  //         const playerDocRef = doc(db, 'players', playerSnapshot.docs[0].id);
  //         await updateDoc(playerDocRef, { actualRoom: currentRoom });
          
  //       }
  //     } else {
  //       const gameRoomsCollection = collection(db, 'games_ably');
  //       const gameData = {
  //         players: [{
  //           id: playerId,
  //           x: 200,
  //           y: 200,
  //           color: COLORS[0],
  //           hasDynamite: true
  //         }],
  //         dynamiteHolder: playerId,
  //         explosionTime: Date.now() + 30000
  //       };
  //       await addDoc(gameRoomsCollection, gameData);
  //     }
  //   } catch (error) {
  //     console.error("Error joining game:", error);
  //     setNotifyCurrentRoom(null);
  //     setIsSpectator(false);
  //   }
  // };  


  const joinGame = async () => {
    if (!account?.address) return;
  
    try {
      const playerQuery = query(collection(db, 'players'), where('wallet', '==', account.address));
      const playerSnapshot = await getDocs(playerQuery);
      
      let playerId = playerSnapshot.docs[0].id;
      setPlayerId(playerSnapshot.docs[0].id);
      
      const gameRef = doc(db, 'games_ably', currentRoom!);
  
      await runTransaction(db, async (transaction) => {
        const gameDoc = await transaction.get(gameRef);
        
        if (!gameDoc.exists()) {
          throw "La sala de juego no existe";
        }
  
        const currentGame = gameDoc.data() as GameState;
        const existingPlayer = currentGame.players.find(p => p.id === playerId);
  
        if (existingPlayer) {
          // El jugador ya está en la sala, no necesitamos hacer nada
          return;
        }
  
        if (currentGame.players.length >= currentGame.totalPlayers) {
          throw "La sala está llena";
        }
  
        const playerIndex = currentGame.players.length;
        const angleStep = (2 * Math.PI) / currentGame.totalPlayers;
        const angle = playerIndex * angleStep;
        
        let rotationAngle = (angle + Math.PI) % (2 * Math.PI);
        let rotationAngleDegrees = (rotationAngle * 180) / Math.PI;
  
        const newPlayer = {
          id: playerId,
          x: ARENA_RADIUS * Math.cos(angle) + 200,
          y: ARENA_RADIUS * Math.sin(angle) + 200,
          angle: rotationAngleDegrees,
          color: COLORS[currentGame.players.length],
          hasDynamite: false, // currentGame.players.length === 0
          isDead: false,
          wallet: account?.address
        };
  
        const updatedPlayers = [...currentGame.players, newPlayer];
        const updatedPlayersWallets = [...(currentGame.playersWallets || []), account?.address];
  
        transaction.update(gameRef, { 
          players: updatedPlayers,
          dynamiteHolder: currentGame.players.length === 0 ? playerId : currentGame.dynamiteHolder,
          playersWallets: updatedPlayersWallets
        });
  
        // Actualizamos la tabla de jugadores
        const playerDocRef = doc(db, 'players', playerId);
        transaction.update(playerDocRef, { actualRoom: currentRoom });
      });
  
      console.log("Jugador unido exitosamente");
    } catch (error) {
      console.error("Error al unirse al juego:", error);
      setNotifyCurrentRoom(null);
      setIsSpectator(false);
      // Aquí puedes manejar los errores específicos, como "La sala está llena" o "La sala de juego no existe"
    }
  };
  
  const createPlayerObject = (player: Player): Promise<fabric.Object> => {
    return new Promise((resolve) => {
      let personaje = player.hasDynamite? `/players/personaje-${player.color}-tnt.svg`:`/players/personaje-${player.color}.svg`
      
      fabric.loadSVGFromURL(personaje, async (objects) => {
        const playerGroup = new fabric.Group(objects, {
          left: player.x,
          top: player.y,
          // angle:player.angle,
          scaleX: 0.2,  // Adjust scale as needed
          scaleY: 0.2,  // Adjust scale as needed
          selectable: false,
          data: { playerId: player.id, hasDynamite: player.hasDynamite }
        });
        
        playerGroup.rotate(player.angle);

        playerGroup.setPositionByOrigin(new fabric.Point(player.x, player.y), 'center', 'center');
        playerGroup.moveTo(10);
        resolve(playerGroup);
      });
    });
  };  

  const updateCanvas = async (fabricCanvas: fabric.Canvas, newGameState: GameState) => {
    
    fabricCanvas.getObjects().forEach((obj, index, objects) => {
      if (obj.data?.playerId) {
        const duplicateIndex = objects.findIndex((otherObj, otherIndex) => 
          otherIndex > index && otherObj.data?.playerId === obj.data.playerId
        );
        if (duplicateIndex !== -1) {
          fabricCanvas.remove(objects[duplicateIndex]);
        }
        if (!newGameState.players.some(p => p.id === obj.data.playerId)) {
          fabricCanvas.remove(obj);
        }
      }
    });

    for (const player of newGameState.players) {

      let playerObject = fabricCanvas.getObjects().find(obj => obj.data?.playerId === player.id);
      
      if (playerObject) {
        if (player.isDead) {
          fabricCanvas.remove(playerObject);  
        } else {
          let personaje = player.hasDynamite ? `/players/personaje-${player.color}-tnt.svg` : `/players/personaje-${player.color}.svg`;
          if (playerObject.data.hasDynamite !== player.hasDynamite) {
            changePlayerSVG(fabricCanvas, player.id, personaje);
          }
        }
      } else if (!player.isDead) {
        playerObject = await createPlayerObject(player);
        fabricCanvas.add(playerObject);
      }
      fabricCanvas.requestRenderAll();
    }

    
    fabricCanvas.renderAll();
  };
 
  const updatePlayerPosition = (fabricCanvas: fabric.Canvas, id: string, x: number, y: number, angle: number, gameState:GameState, setGameState: (state: GameState) => void) => {
    if(!gameStateRef.current.winner && gameStateRef.current.winner!="") return
    const playerObject = fabricCanvas.getObjects().find(obj => obj.data?.playerId === id) as fabric.Group;
    if (playerObject) {

      // Aplicamos la nueva rotación
      playerObject.rotate(angle);
      // Poscicion anterior
      playerObject.setPositionByOrigin(new fabric.Point(x, y), 'center', 'center');
      playerObject.moveTo(10);

      fabricCanvas.requestRenderAll();
      // console.log(gameState.players)

      let objects = fabricCanvas.getObjects().filter(obj=>obj.data?.playerId)
      // let updateGameState:any = {}
      // updateGameState.dynamiteHolder = gameState?.dynamiteHolder
      // updateGameState.explosionTime = gameState?.explosionTime
      // updateGameState.winner = gameState?.winner
      let updatedPlayers:Player[] = []
      objects.forEach(obj=>{
        let point = obj.getCenterPoint()
        let player = gameState?.players.find(p=>p.id==obj.data?.playerId)
        player!.x = point.x
        player!.y = point.y
        player!.angle = obj.angle!
        updatedPlayers.push(player!)        
      })
      //console.log(gameStateRef.current)
      // gameStateRef.current = updateGameState
      // setGameState(updateGameState);
      setGameState({
        ...gameState,
        players: updatedPlayers
      });
  
    }
  };

  const updateDynamiteHolder = async (newHolderId: string) => {
    // Crear un mapa para mantener track de los últimos jugadores con IDs únicos
    const uniquePlayers = new Map();
    
    // Si gameState?.players existe, procesamos los jugadores
    if (gameState?.players) {
      // Iteramos los jugadores en orden inverso para mantener los últimos agregados
      for (let i = gameState.players.length - 1; i >= 0; i--) {
        const player = gameState.players[i];
        if (!uniquePlayers.has(player.id)) {
          // Si el ID no existe en el mapa, lo agregamos
          uniquePlayers.set(player.id, {
            ...player,
            hasDynamite: player.id === newHolderId
          });
        }
      }
    }
    
    // Convertimos el mapa de jugadores únicos a un array
    const updatedPlayers = Array.from(uniquePlayers.values());
    // console.log(updatedPlayers)    
    setGameState((prevState:any) => ({
      ...prevState,
      players: updatedPlayers
    }));

    const gameRef = doc(db, 'games_ably', currentRoom!);
    await updateDoc(gameRef, {
      dynamiteHolder: newHolderId,
      explosionTime: Date.now() + getRandomExplosionTime(),
      players: updatedPlayers
    });
  };

  const startDynamitePassing = () => {
    const passDynamite = async () => {
      const gameRef = doc(db, 'games_ably', currentRoom!);
      let gameRoom = await (await getDoc(gameRef)).data() as GameState
      if (!gameRoom || gameRoom.winner!="") return;

      const alivePlayers = gameRoom.players.filter((p:Player) => (!p.isDead));
      const someHasDinamite = gameRoom.players.filter((p:Player) => (!p.isDead && p.hasDynamite));
      if (alivePlayers.length > 1 && someHasDinamite.length<=0) {
        const randomPlayer = alivePlayers[Math.floor(Math.random() * alivePlayers.length)];
        // await updateDynamiteHolder(randomPlayer.id);
        const gameRef = doc(db, 'games_ably', currentRoom!);
        await updateDoc(gameRef, {
          dynamiteHolder: randomPlayer.id,
          explosionTime: Date.now() + getRandomExplosionTime(),
          players: gameRoom?.players.map((p:any) => ({
            ...p,
            hasDynamite: p.id === randomPlayer.id
          })) || []
        });
      }

      if (gameRoom && gameRoom.winner !== "") {
        if (startDynamitePassingTimeoutRef.current) clearTimeout(startDynamitePassingTimeoutRef.current); 
        return;
      }

      startDynamitePassingTimeoutRef.current = setTimeout(passDynamite, getRandomPassTime());
    };

    startDynamitePassingTimeoutRef.current = setTimeout(passDynamite, getRandomPassTime());
  };

  const getRandomPassTime = () => {
    return Math.floor(Math.random() * (6000 - 4000 + 1) + 4000); // Random time between 3 to 5 seconds
  };

  const getRandomExplosionTime = () => {
    return Math.floor(Math.random() * (14000 - 8000 + 1) + 8000); // Random time between 5 to 10 seconds
  };

  const verifyExplotion = ()=>{
    const handleExplosion = async () => {
      //  console.log(gameStateRef.current)
      const gameRef = doc(db, 'games_ably', currentRoom!);
      let gameRoom = await (await getDoc(gameRef)).data() as GameState
      if (!gameRoom || gameRoom.winner!="") return;
      
      if (gameRoom && (gameRoom.explosionTime && Date.now() >= gameRoom.explosionTime)) {
        
        const gameRef = doc(db, 'games_ably', currentRoom!);

        if (!gameRoom.dynamiteHolder) return;
    
        const updatedPlayers = gameRoom.players.map((player:Player) => ({
          ...player,
          isDead: player.id === gameRoom.dynamiteHolder ? true : player.isDead,
          hasDynamite: false
        }));
    
        const alivePlayers = updatedPlayers.filter((p:any) => !p.isDead);
    
        let winnerId = null;
    
        if (alivePlayers.length === 1) {
          winnerId = alivePlayers[0].id;
        } 

        // console.log(updatedPlayers)
        if(winnerId){
          const playerRef = doc(db, 'players', winnerId);
          const gameDoc = await getDoc(playerRef);
          const player = gameDoc.data()
      
          await updateDoc(gameRef, {
            players: updatedPlayers,
            winner: winnerId,
            winnerWallet:player?.wallet
          });
        }else{
          await updateDoc(gameRef, {
            players: updatedPlayers,
          });
        }
    
      }
      gameRoom = await (await getDoc(gameRef)).data() as GameState;

      if (gameRoom && gameRoom.winner !== "") {
        if (explosionTimeoutRef.current) clearTimeout(explosionTimeoutRef.current); 
        return;
      }

      explosionTimeoutRef.current = setTimeout(handleExplosion, 1000);
    };
  
    explosionTimeoutRef.current = setTimeout(handleExplosion, 1000);
  };

  
  const handleCountdownEnd = useCallback(() => {
    setShowCounter(false);
    playGameAfterStart.current=true
    startDynamitePassing();
    verifyExplotion()
  }, []);

  return (
    <div className="absolute w-full h-full top-0 right-0 flex flex-col items-center justify-center min-h-screen bg-yellow-100">
      <div className="text-4xl font-bold mb-4 text-yellow-800">Dinamite</div>
      <div>
        {showCounter && (
          <GameCounter onCountdownEnd={handleCountdownEnd} />
        )}
      </div>
      <canvas
        ref={canvasRef}
        tabIndex={0}
      />
      <div>
        {gameState && <WonOrLostModal
          isOpen={isModalOpen}
          amount= {wonAmount}
          isBet = {gameState!.isBettingRoom}
          isWon={isWon}
          isPlayEnd = {isPlayEnd}
          status_game = {statusContractGame}
          room_code_contract = {gameState!.roomIdContract}
          onClose={() => setModalOpen(false)}
        />}
      </div>
    </div>
  );
};