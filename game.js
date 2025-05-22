// Initialize the WebsimSocket for realtime communication
const room = new WebsimSocket();
let myRatImage = null;
let chunkSize = 500; // Maze chunk size in pixels
let tileSize = 50; // Size of each tile in the maze
let playerRats = {}; // Store all player rats
let myRat = null; // Current player's rat
let mazeChunks = {}; // Store all loaded maze chunks
let canvas, ctx;
let cameraX = 0, cameraY = 0;
let keysPressed = {};
let lastTimestamp = 0;
const RAT_SIZE = 40;

// Game initialization
async function initGame() {
    canvas = document.getElementById('maze-canvas');
    ctx = canvas.getContext('2d');
    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);
    
    // Generate player's rat with transparent background
    await generateRat();
    updateProgressBar(50);
    
    // Initialize room connection
    await room.initialize();
    updateProgressBar(70);
    
    setupEventListeners();
    
    // Initialize player's rat state
    myRat = {
        x: 0,
        y: 0,
        chunkX: 0,
        chunkY: 0,
        energy: 100,
        hydration: 100,
        alertness: 50,
        lastUpdate: Date.now()
    };
    
    // Load initial chunk
    await loadChunk(0, 0);
    updateProgressBar(90);
    
    // Find a valid position for the rat in the initial chunk
    const validPosition = findValidRatPosition(mazeChunks['0,0'], myRat.x, myRat.y);
    myRat.x = validPosition.x;
    myRat.y = validPosition.y;
    
    // Update presence with initial rat state
    room.updatePresence({
        ratState: {
            x: myRat.x,
            y: myRat.y,
            chunkX: myRat.chunkX,
            chunkY: myRat.chunkY,
            energy: myRat.energy,
            hydration: myRat.hydration,
            alertness: myRat.alertness
        },
        ratImageUrl: myRatImage.src
    });
    
    // Subscribe to presence updates
    room.subscribePresence(handlePresenceUpdate);
    
    // Hide loading screen
    setTimeout(() => {
        document.getElementById('loading-screen').style.display = 'none';
    }, 500);
    
    // Start game loop
    requestAnimationFrame(gameLoop);
}

function resizeCanvas() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
}

async function generateRat() {
    updateProgressBar(10);
    try {
        // Generate a unique rat image using AI
        const result = await websim.imageGen({
            prompt: "Cartoon rat character, cute, detailed, front view, white background",
            transparent: true
        });
        updateProgressBar(30);
        
        // Load the generated image
        myRatImage = new Image();
        myRatImage.src = result.url;
        
        return new Promise((resolve) => {
            myRatImage.onload = () => {
                resolve();
            };
        });
    } catch (error) {
        console.error("Failed to generate rat image:", error);
        // Fallback to a default rat image
        myRatImage = new Image();
        myRatImage.src = "https://via.placeholder.com/40";
        return new Promise((resolve) => {
            myRatImage.onload = resolve;
        });
    }
}

function updateProgressBar(percent) {
    document.getElementById('progress-bar').style.width = `${percent}%`;
}

function setupEventListeners() {
    // Keyboard controls
    window.addEventListener('keydown', (e) => {
        keysPressed[e.key] = true;
    });
    
    window.addEventListener('keyup', (e) => {
        keysPressed[e.key] = false;
    });
    
    // Mouse click to startle rats
    canvas.addEventListener('click', (e) => {
        const rect = canvas.getBoundingClientRect();
        const clickX = e.clientX - rect.left + cameraX;
        const clickY = e.clientY - rect.top + cameraY;
        
        // Send a startle event to all rats within range
        room.send({
            type: "startle",
            x: clickX,
            y: clickY,
            radius: 150
        });
        
        // Startle own rat if within range
        const dx = clickX - (myRat.x + chunkSize * myRat.chunkX);
        const dy = clickY - (myRat.y + chunkSize * myRat.chunkY);
        const distance = Math.sqrt(dx * dx + dy * dy);
        
        if (distance < 150) {
            myRat.alertness = Math.min(100, myRat.alertness + 50);
            updateRatStats();
        }
    });
    
    // Handle startle events
    room.onmessage = (event) => {
        const data = event.data;
        if (data.type === "startle") {
            const dx = data.x - (myRat.x + chunkSize * myRat.chunkX);
            const dy = data.y - (myRat.y + chunkSize * myRat.chunkY);
            const distance = Math.sqrt(dx * dx + dy * dy);
            
            if (distance < data.radius) {
                myRat.alertness = Math.min(100, myRat.alertness + 50);
                updateRatStats();
            }
        }
    };
}

async function loadChunk(x, y) {
    const chunkId = `${x},${y}`;
    
    // Check if the chunk is already loaded
    if (mazeChunks[chunkId]) {
        return mazeChunks[chunkId];
    }
    
    // Try to get the chunk from the database
    let chunks = room.collection('maze_chunk').filter({ id: chunkId }).getList();
    
    if (chunks.length === 0) {
        // Chunk doesn't exist yet, create it
        const newChunk = await generateMazeChunk(x, y);
        await room.collection('maze_chunk').create({
            id: chunkId,
            exits: newChunk.exits,
            walls: newChunk.walls
        });
        
        mazeChunks[chunkId] = newChunk;
        return newChunk;
    } else {
        // Chunk exists, load it
        const chunkData = chunks[0];
        mazeChunks[chunkId] = {
            x,
            y,
            exits: chunkData.exits,
            walls: chunkData.walls
        };
        return mazeChunks[chunkId];
    }
}

async function generateMazeChunk(x, y) {
    // Get adjacent chunks to ensure exits align
    const adjacentChunks = {
        north: await getAdjacentChunk(x, y-1),
        east: await getAdjacentChunk(x+1, y),
        south: await getAdjacentChunk(x, y+1),
        west: await getAdjacentChunk(x-1, y)
    };
    
    // Calculate exits based on adjacent chunks
    const exits = {
        north: adjacentChunks.north ? adjacentChunks.north.exits.south : Math.random() > 0.25,
        east: adjacentChunks.east ? adjacentChunks.east.exits.west : Math.random() > 0.25,
        south: adjacentChunks.south ? adjacentChunks.south.exits.north : Math.random() > 0.25,
        west: adjacentChunks.west ? adjacentChunks.west.exits.east : Math.random() > 0.25
    };
    
    // Special case: ensure the spawn chunk (0,0) has all exits open
    if (x === 0 && y === 0) {
        exits.north = true;
        exits.east = true;
        exits.south = true;
        exits.west = true;
    } else {
        // Handle the 1/16 chance of blocking a second exit, but only if more than one exit is open
        const openExitCount = Object.values(exits).filter(Boolean).length;
        if (openExitCount > 2 && Math.random() < 0.0625) {
            // Block a second random exit
            const openExits = Object.keys(exits).filter(dir => exits[dir]);
            if (openExits.length > 0) {
                const randomExit = openExits[Math.floor(Math.random() * openExits.length)];
                exits[randomExit] = false;
            }
        }
    }
    
    // Generate walls for the maze chunk
    const walls = generateWalls(exits);
    
    return {
        x,
        y,
        exits,
        walls
    };
}

async function getAdjacentChunk(x, y) {
    const chunkId = `${x},${y}`;
    
    // Check if the chunk is already loaded
    if (mazeChunks[chunkId]) {
        return mazeChunks[chunkId];
    }
    
    // Try to get the chunk from the database
    let chunks = room.collection('maze_chunk').filter({ id: chunkId }).getList();
    
    if (chunks.length === 0) {
        return null;
    } else {
        const chunkData = chunks[0];
        mazeChunks[chunkId] = {
            x,
            y,
            exits: chunkData.exits,
            walls: chunkData.walls
        };
        return mazeChunks[chunkId];
    }
}

function generateWalls(exits) {
    // Create a grid of walls for the maze chunk
    const gridSize = chunkSize / tileSize;
    const walls = [];
    
    // Create a simple maze layout with the specified exits
    for (let y = 0; y < gridSize; y++) {
        for (let x = 0; x < gridSize; x++) {
            // Border walls except at exits
            if (y === 0 && !(x === Math.floor(gridSize/2) && exits.north)) {
                walls.push({x, y, dir: 'horizontal'});
            }
            
            if (y === gridSize-1 && !(x === Math.floor(gridSize/2) && exits.south)) {
                walls.push({x, y: y+1, dir: 'horizontal'});
            }
            
            if (x === 0 && !(y === Math.floor(gridSize/2) && exits.west)) {
                walls.push({x, y, dir: 'vertical'});
            }
            
            if (x === gridSize-1 && !(y === Math.floor(gridSize/2) && exits.east)) {
                walls.push({x: x+1, y, dir: 'vertical'});
            }
            
            // Internal walls - random maze generation
            if (x < gridSize-1 && y > 0 && Math.random() > 0.7) {
                walls.push({x: x+1, y, dir: 'vertical'});
            }
            
            if (y < gridSize-1 && x > 0 && Math.random() > 0.7) {
                walls.push({x, y: y+1, dir: 'horizontal'});
            }
        }
    }
    
    return walls;
}

function handlePresenceUpdate(presence) {
    // Update other players' rats
    for (const clientId in presence) {
        if (clientId !== room.clientId && presence[clientId].ratState) {
            if (!playerRats[clientId]) {
                // New player joined
                playerRats[clientId] = {
                    ...presence[clientId].ratState,
                    image: new Image()
                };
                playerRats[clientId].image.src = presence[clientId].ratImageUrl;
            } else {
                // Update existing player but keep the image object
                const currentImage = playerRats[clientId].image;
                playerRats[clientId] = {
                    ...presence[clientId].ratState,
                    image: currentImage
                };
            }
        }
    }
    
    // Remove disconnected players
    for (const clientId in playerRats) {
        if (!presence[clientId]) {
            delete playerRats[clientId];
        }
    }
    
    // Update player list UI
    updatePlayerList();
}

function updatePlayerList() {
    const container = document.getElementById('players-container');
    container.innerHTML = '<h3>Rats in Maze</h3>';
    
    // Add current player
    const myUsername = room.peers[room.clientId].username;
    const myDiv = document.createElement('div');
    myDiv.className = 'player';
    myDiv.innerHTML = `
        <img class="player-avatar" src="https://images.websim.com/avatar/${myUsername}" alt="${myUsername}">
        <span>${myUsername} (You)</span>
    `;
    container.appendChild(myDiv);
    
    // Add other players
    for (const clientId in playerRats) {
        if (room.peers[clientId]) {
            const username = room.peers[clientId].username;
            const playerDiv = document.createElement('div');
            playerDiv.className = 'player';
            playerDiv.innerHTML = `
                <img class="player-avatar" src="https://images.websim.com/avatar/${username}" alt="${username}">
                <span>${username}</span>
            `;
            container.appendChild(playerDiv);
        }
    }
}

function updateRatStats() {
    document.getElementById('energy-fill').style.width = `${myRat.energy}%`;
    document.getElementById('hydration-fill').style.width = `${myRat.hydration}%`;
    document.getElementById('alertness-fill').style.width = `${myRat.alertness}%`;
}

function gameLoop(timestamp) {
    if (!lastTimestamp) lastTimestamp = timestamp;
    const deltaTime = (timestamp - lastTimestamp) / 1000; // Convert to seconds
    lastTimestamp = timestamp;
    
    // Update rat state
    updateRat(deltaTime);
    
    // Render the game
    render();
    
    // Request next frame
    requestAnimationFrame(gameLoop);
}

function updateRat(deltaTime) {
    // Update rat stats over time
    myRat.energy = Math.max(10, myRat.energy - deltaTime * 2); // Slowly decrease energy
    myRat.hydration = Math.max(10, myRat.hydration - deltaTime * 3); // Decrease hydration faster
    myRat.alertness = Math.max(10, myRat.alertness - deltaTime * 5); // Alertness decreases quickly
    
    // Calculate movement speed based on rat stats
    let speed = calculateRatSpeed();
    
    // Handle keyboard input for movement
    let dx = 0, dy = 0;
    
    if (keysPressed['ArrowUp'] || keysPressed['w']) dy -= speed * deltaTime;
    if (keysPressed['ArrowDown'] || keysPressed['s']) dy += speed * deltaTime;
    if (keysPressed['ArrowLeft'] || keysPressed['a']) dx -= speed * deltaTime;
    if (keysPressed['ArrowRight'] || keysPressed['d']) dx += speed * deltaTime;
    
    // Check for collisions before moving
    if (dx !== 0 || dy !== 0) {
        const newX = myRat.x + dx;
        const newY = myRat.y + dy;
        
        // Check if the new position is within a wall
        if (!isColliding(newX, newY)) {
            myRat.x = newX;
            myRat.y = newY;
        } else {
            // Handle collision - slide along walls
            if (dx !== 0 && !isColliding(myRat.x, newY)) {
                myRat.y = newY;
            } else if (dy !== 0 && !isColliding(newX, myRat.y)) {
                myRat.x = newX;
            }
        }
        
        // Check if we need to move to a new chunk
        checkChunkTransition();
        
        // Update presence if rat moved
        if (Date.now() - myRat.lastUpdate > 50) { // Throttle updates
            myRat.lastUpdate = Date.now();
            room.updatePresence({
                ratState: {
                    x: myRat.x,
                    y: myRat.y,
                    chunkX: myRat.chunkX,
                    chunkY: myRat.chunkY,
                    energy: myRat.energy,
                    hydration: myRat.hydration,
                    alertness: myRat.alertness
                },
                ratImageUrl: myRatImage.src
            });
        }
    }
    
    // Update camera position to follow the rat
    cameraX = myRat.x + chunkSize * myRat.chunkX - canvas.width / 2;
    cameraY = myRat.y + chunkSize * myRat.chunkY - canvas.height / 2;
    
    // Update UI
    updateRatStats();
}

function calculateRatSpeed() {
    // Base speed
    let speed = 100;
    
    // Adjust based on energy
    if (myRat.energy < 30) {
        speed *= 0.7; // Slower when low energy
    } else if (myRat.energy > 70) {
        speed *= 1.2; // Faster when high energy
    }
    
    // Adjust based on hydration
    if (myRat.hydration < 30) {
        speed *= 0.8; // Slower when dehydrated
    }
    
    // Adjust based on alertness
    if (myRat.alertness > 70) {
        speed *= 1.5; // Much faster when startled/alert
    }
    
    return speed;
}

async function checkChunkTransition() {
    let newChunkX = myRat.chunkX;
    let newChunkY = myRat.chunkY;
    let reposition = false;
    
    // Check if rat moved out of current chunk
    if (myRat.x < 0) {
        newChunkX--;
        myRat.x += chunkSize;
        reposition = true;
    } else if (myRat.x > chunkSize) {
        newChunkX++;
        myRat.x -= chunkSize;
        reposition = true;
    }
    
    if (myRat.y < 0) {
        newChunkY--;
        myRat.y += chunkSize;
        reposition = true;
    } else if (myRat.y > chunkSize) {
        newChunkY++;
        myRat.y -= chunkSize;
        reposition = true;
    }
    
    // If we moved to a new chunk, load it
    if (reposition) {
        await loadChunk(newChunkX, newChunkY);
        myRat.chunkX = newChunkX;
        myRat.chunkY = newChunkY;
        
        // Ensure the rat is placed in a valid position in the new chunk
        const chunkId = `${newChunkX},${newChunkY}`;
        if (mazeChunks[chunkId]) {
            const validPosition = findValidRatPosition(mazeChunks[chunkId], myRat.x, myRat.y);
            myRat.x = validPosition.x;
            myRat.y = validPosition.y;
        }
        
        // Also load adjacent chunks for seamless transitions
        loadChunk(newChunkX - 1, newChunkY);
        loadChunk(newChunkX + 1, newChunkY);
        loadChunk(newChunkX, newChunkY - 1);
        loadChunk(newChunkX, newChunkY + 1);
    }
}

function findValidRatPosition(chunk, startX, startY) {
    // If the starting position is valid, use it
    if (!isCollidingAt(startX, startY, chunk)) {
        return { x: startX, y: startY };
    }
    
    // If not, use breadth-first search to find a valid position
    const queue = [];
    const visited = new Set();
    const startKey = `${Math.floor(startX/10)},${Math.floor(startY/10)}`;
    
    // Start with the center of the chunk as an alternative
    queue.push({ x: chunkSize/2, y: chunkSize/2 });
    
    // Try positions near the exits
    if (chunk.exits.north) queue.push({ x: chunkSize/2, y: tileSize + RAT_SIZE });
    if (chunk.exits.south) queue.push({ x: chunkSize/2, y: chunkSize - tileSize - RAT_SIZE });
    if (chunk.exits.east) queue.push({ x: chunkSize - tileSize - RAT_SIZE, y: chunkSize/2 });
    if (chunk.exits.west) queue.push({ x: tileSize + RAT_SIZE, y: chunkSize/2 });
    
    // Then try the original position
    queue.push({ x: startX, y: startY });
    visited.add(startKey);
    
    // Check grid points in the chunk (10px resolution to speed up search)
    const gridSize = chunkSize / 10;
    for (let y = 0; y < gridSize; y++) {
        for (let x = 0; x < gridSize; x++) {
            const posX = x * 10 + 5;
            const posY = y * 10 + 5;
            const key = `${x},${y}`;
            
            if (!visited.has(key)) {
                queue.push({ x: posX, y: posY });
                visited.add(key);
            }
        }
    }
    
    // Process the queue
    for (const pos of queue) {
        if (!isCollidingAt(pos.x, pos.y, chunk)) {
            return pos;
        }
    }
    
    // If no valid position found, return the center of the chunk as a last resort
    return { x: chunkSize/2, y: chunkSize/2 };
}

function isCollidingAt(x, y, chunk) {
    if (!chunk) return true; // Consider out of bounds as a collision
    
    // Check collision with walls
    for (const wall of chunk.walls) {
        const wallX = wall.x * tileSize;
        const wallY = wall.y * tileSize;
        
        if (wall.dir === 'horizontal') {
            // Horizontal wall segment
            if (y + RAT_SIZE/2 > wallY - 2 && y - RAT_SIZE/2 < wallY + 2 &&
                x + RAT_SIZE/2 > wallX && x - RAT_SIZE/2 < wallX + tileSize) {
                return true;
            }
        } else {
            // Vertical wall segment
            if (x + RAT_SIZE/2 > wallX - 2 && x - RAT_SIZE/2 < wallX + 2 &&
                y + RAT_SIZE/2 > wallY && y - RAT_SIZE/2 < wallY + tileSize) {
                return true;
            }
        }
    }
    
    // Also check if position is out of bounds for the chunk
    if (x < 0 || x > chunkSize || y < 0 || y > chunkSize) {
        return true;
    }
    
    return false;
}

function isColliding(x, y) {
    const currentChunkId = `${myRat.chunkX},${myRat.chunkY}`;
    const chunk = mazeChunks[currentChunkId];
    return isCollidingAt(x, y, chunk);
}

function render() {
    // Clear canvas
    ctx.fillStyle = '#222';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    
    // Render visible chunks
    const centerChunkX = myRat.chunkX;
    const centerChunkY = myRat.chunkY;
    
    // Render nearby chunks (3x3 grid centered on current chunk)
    for (let y = centerChunkY - 1; y <= centerChunkY + 1; y++) {
        for (let x = centerChunkX - 1; x <= centerChunkX + 1; x++) {
            const chunkId = `${x},${y}`;
            if (mazeChunks[chunkId]) {
                renderChunk(mazeChunks[chunkId]);
            }
        }
    }
    
    // Render all rats
    renderRats();
}

function renderChunk(chunk) {
    const offsetX = chunk.x * chunkSize - cameraX;
    const offsetY = chunk.y * chunkSize - cameraY;
    
    // Draw chunk background
    ctx.fillStyle = '#333';
    ctx.fillRect(offsetX, offsetY, chunkSize, chunkSize);
    
    // Draw chunk border for debugging
    ctx.strokeStyle = '#444';
    ctx.strokeRect(offsetX, offsetY, chunkSize, chunkSize);
    
    // Draw walls
    ctx.strokeStyle = '#777';
    ctx.lineWidth = 3;
    
    for (const wall of chunk.walls) {
        ctx.beginPath();
        if (wall.dir === 'horizontal') {
            ctx.moveTo(offsetX + wall.x * tileSize, offsetY + wall.y * tileSize);
            ctx.lineTo(offsetX + (wall.x + 1) * tileSize, offsetY + wall.y * tileSize);
        } else {
            ctx.moveTo(offsetX + wall.x * tileSize, offsetY + wall.y * tileSize);
            ctx.lineTo(offsetX + wall.x * tileSize, offsetY + (wall.y + 1) * tileSize);
        }
        ctx.stroke();
    }
    
    // Draw exit markers for debugging
    const midPoint = chunkSize / 2;
    ctx.fillStyle = '#4CAF50';
    
    if (chunk.exits.north) {
        ctx.fillRect(offsetX + midPoint - 5, offsetY, 10, 10);
    }
    if (chunk.exits.east) {
        ctx.fillRect(offsetX + chunkSize - 10, offsetY + midPoint - 5, 10, 10);
    }
    if (chunk.exits.south) {
        ctx.fillRect(offsetX + midPoint - 5, offsetY + chunkSize - 10, 10, 10);
    }
    if (chunk.exits.west) {
        ctx.fillRect(offsetX, offsetY + midPoint - 5, 10, 10);
    }
    
    // Draw chunk coordinates for debugging
    ctx.fillStyle = '#666';
    ctx.font = '14px Arial';
    ctx.fillText(`[${chunk.x},${chunk.y}]`, offsetX + 10, offsetY + 20);
}

function renderRats() {
    // Render other player rats
    for (const clientId in playerRats) {
        const rat = playerRats[clientId];
        if (rat.image && rat.image.complete) {
            const x = rat.x + rat.chunkX * chunkSize - cameraX - RAT_SIZE/2;
            const y = rat.y + rat.chunkY * chunkSize - cameraY - RAT_SIZE/2;
            ctx.drawImage(rat.image, x, y, RAT_SIZE, RAT_SIZE);
            
            // Draw username above the rat
            if (room.peers[clientId]) {
                ctx.fillStyle = 'white';
                ctx.font = '12px Arial';
                ctx.textAlign = 'center';
                ctx.fillText(room.peers[clientId].username, x + RAT_SIZE/2, y - 5);
            }
        }
    }
    
    // Render the player's rat (don't need to store image in myRat object)
    if (myRatImage && myRatImage.complete) {
        const x = myRat.x - cameraX - RAT_SIZE/2;
        const y = myRat.y - cameraY - RAT_SIZE/2;
        ctx.drawImage(myRatImage, x, y, RAT_SIZE, RAT_SIZE);
        
        // Draw username above the rat
        if (room.peers[room.clientId]) {
            ctx.fillStyle = 'white';
            ctx.font = '12px Arial';
            ctx.textAlign = 'center';
            ctx.fillText(room.peers[room.clientId].username, x + RAT_SIZE/2, y - 5);
        }
    }
}

// Start the game when the page loads
window.addEventListener('load', initGame);