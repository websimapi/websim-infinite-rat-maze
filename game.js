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

// Game resources
let cheeseImage = null;
let waterImage = null;
let resourceSpawns = {}; // Store resources for each chunk

// AI control flag
let aiControlEnabled = false;
let aiControlButton = null;

// Game initialization
async function initGame() {
    canvas = document.getElementById('maze-canvas');
    ctx = canvas.getContext('2d');
    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);

    // Generate player's rat with transparent background
    await generateRat();
    updateProgressBar(40);

    // Load game resources
    await loadResources();
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
        lastUpdate: Date.now(),
        // AI state variables
        aiEnabled: false,
        aiState: {
            currentGoal: 'wander', // wander, seek_food, seek_water, flee
            targetX: null,
            targetY: null,
            targetChunkX: null,
            targetChunkY: null,
            wanderDirection: Math.random() * Math.PI * 2,
            wanderTimer: 0,
            pathfindingNodes: [],
            lastDecisionTime: 0,
            memoryMap: {}, // Remember interesting locations
            fleeTarget: null,
            stuckTimer: 0
        }
    };

    // Load initial chunk
    await loadChunk(0, 0);
    updateProgressBar(90);

    // Find a valid position for the rat in the initial chunk
    const validPosition = findValidRatPosition(mazeChunks['0,0'], myRat.x, myRat.y);
    myRat.x = validPosition.x;
    myRat.y = validPosition.y;

    // Create AI control button
    createAIControlButton();

    // Update presence with initial rat state
    room.updatePresence({
        ratState: {
            x: myRat.x,
            y: myRat.y,
            chunkX: myRat.chunkX,
            chunkY: myRat.chunkY,
            energy: myRat.energy,
            hydration: myRat.hydration,
            alertness: myRat.alertness,
            aiEnabled: myRat.aiEnabled
        },
        ratImageUrl: myRatImage.src
    });

    // Subscribe to presence updates
    room.subscribePresence(handlePresenceUpdate);

    // Generate resources for the initial chunk
    await generateResourcesForChunk(0, 0);

    // Hide loading screen
    setTimeout(() => {
        document.getElementById('loading-screen').style.display = 'none';
    }, 500);

    // Start game loop
    requestAnimationFrame(gameLoop);
}

// ... existing code ...

async function loadResources() {
    // Load cheese image
    cheeseImage = new Image();
    cheeseImage.src = 'cheese.png';

    // Load water image
    waterImage = new Image();
    waterImage.src = 'water_drop.png';

    // Wait for images to load
    return Promise.all([
        new Promise(resolve => cheeseImage.onload = resolve),
        new Promise(resolve => waterImage.onload = resolve)
    ]);
}

function createAIControlButton() {
    // Create a button to toggle AI control
    aiControlButton = document.createElement('button');
    aiControlButton.textContent = 'Enable AI Control';
    aiControlButton.style.position = 'absolute';
    aiControlButton.style.bottom = '20px';
    aiControlButton.style.left = '20px';
    aiControlButton.style.padding = '10px';
    aiControlButton.style.backgroundColor = '#4CAF50';
    aiControlButton.style.color = 'white';
    aiControlButton.style.border = 'none';
    aiControlButton.style.borderRadius = '5px';
    aiControlButton.style.cursor = 'pointer';
    aiControlButton.style.zIndex = '100';

    aiControlButton.addEventListener('click', toggleAIControl);

    document.getElementById('game-container').appendChild(aiControlButton);
}

function toggleAIControl() {
    myRat.aiEnabled = !myRat.aiEnabled;
    aiControlButton.textContent = myRat.aiEnabled ? 'Disable AI Control' : 'Enable AI Control';
    aiControlButton.style.backgroundColor = myRat.aiEnabled ? '#f44336' : '#4CAF50';

    // Reset AI state when enabling
    if (myRat.aiEnabled) {
        myRat.aiState.currentGoal = 'wander';
        myRat.aiState.wanderDirection = Math.random() * Math.PI * 2;
        myRat.aiState.lastDecisionTime = Date.now();
    }

    // Update presence to inform other clients
    room.updatePresence({
        ratState: {
            x: myRat.x,
            y: myRat.y,
            chunkX: myRat.chunkX,
            chunkY: myRat.chunkY,
            energy: myRat.energy,
            hydration: myRat.hydration,
            alertness: myRat.alertness,
            aiEnabled: myRat.aiEnabled
        },
        ratImageUrl: myRatImage.src
    });
}

async function generateResourcesForChunk(chunkX, chunkY) {
    const chunkId = `${chunkX},${chunkY}`;

    // Check if resources already exist for this chunk
    if (resourceSpawns[chunkId]) {
        return;
    }

    // Create resources for the chunk
    const resources = [];

    // Generate 2-4 food (cheese) items
    const foodCount = Math.floor(Math.random() * 3) + 2;
    for (let i = 0; i < foodCount; i++) {
        let x, y;
        let validPosition = false;

        // Find a valid position for the food
        for (let attempts = 0; attempts < 20 && !validPosition; attempts++) {
            x = Math.random() * (chunkSize - 60) + 30;
            y = Math.random() * (chunkSize - 60) + 30;

            // Check if the position is valid (not in a wall)
            if (!isCollidingAt(x, y, mazeChunks[chunkId])) {
                validPosition = true;
            }
        }

        if (validPosition) {
            resources.push({
                type: 'food',
                x: x,
                y: y,
                value: 50 + Math.random() * 30 // Energy value
            });
        }
    }

    // Generate 1-3 water sources
    const waterCount = Math.floor(Math.random() * 3) + 1;
    for (let i = 0; i < waterCount; i++) {
        let x, y;
        let validPosition = false;

        // Find a valid position for the water
        for (let attempts = 0; attempts < 20 && !validPosition; attempts++) {
            x = Math.random() * (chunkSize - 60) + 30;
            y = Math.random() * (chunkSize - 60) + 30;

            // Check if the position is valid (not in a wall)
            if (!isCollidingAt(x, y, mazeChunks[chunkId])) {
                validPosition = true;
            }
        }

        if (validPosition) {
            resources.push({
                type: 'water',
                x: x,
                y: y,
                value: 60 + Math.random() * 40 // Hydration value
            });
        }
    }

    // Store the resources for this chunk
    resourceSpawns[chunkId] = resources;

    // Store in the database for persistence
    await room.collection('resources').create({
        id: chunkId,
        resources: resources
    });
}

// ... existing code ...

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
    } else {
        // Chunk exists, load it
        const chunkData = chunks[0];
        mazeChunks[chunkId] = {
            x,
            y,
            exits: chunkData.exits,
            walls: chunkData.walls
        };
    }

    // Load or generate resources for the chunk
    let resourceData = room.collection('resources').filter({ id: chunkId }).getList();
    if (resourceData.length === 0) {
        await generateResourcesForChunk(x, y);
    } else {
        resourceSpawns[chunkId] = resourceData[0].resources;
    }

    return mazeChunks[chunkId];
}

// ... existing code ...

function updateRat(deltaTime) {
    // Update rat stats over time
    myRat.energy = Math.max(10, myRat.energy - deltaTime * 2); // Slowly decrease energy
    myRat.hydration = Math.max(10, myRat.hydration - deltaTime * 3); // Decrease hydration faster
    myRat.alertness = Math.max(10, myRat.alertness - deltaTime * 5); // Alertness decreases quickly

    // Calculate movement speed based on rat stats
    let speed = calculateRatSpeed();

    if (myRat.aiEnabled) {
        // AI controls the rat
        updateRatAI(deltaTime, speed);
    } else {
        // Handle keyboard input for movement
        let dx = 0, dy = 0;

        if (keysPressed['ArrowUp'] || keysPressed['w']) dy -= speed * deltaTime;
        if (keysPressed['ArrowDown'] || keysPressed['s']) dy += speed * deltaTime;
        if (keysPressed['ArrowLeft'] || keysPressed['a']) dx -= speed * deltaTime;
        if (keysPressed['ArrowRight'] || keysPressed['d']) dx += speed * deltaTime;

        moveRat(dx, dy);
    }

    // Check for resource collection
    checkResourceCollection();

    // Update camera position to follow the rat
    cameraX = myRat.x + chunkSize * myRat.chunkX - canvas.width / 2;
    cameraY = myRat.y + chunkSize * myRat.chunkY - canvas.height / 2;

    // Update UI
    updateRatStats();
}

function moveRat(dx, dy) {
    // Only proceed if there's movement
    if (dx === 0 && dy === 0) return;

    const newX = myRat.x + dx;
    const newY = myRat.y + dy;

    // Check if the new position is within a wall
    if (!isColliding(newX, newY)) {
        myRat.x = newX;
        myRat.y = newY;
        myRat.aiState.stuckTimer = 0; // Reset stuck timer when moving successfully
    } else {
        // Handle collision - slide along walls
        if (dx !== 0 && !isColliding(myRat.x, newY)) {
            myRat.y = newY;
            myRat.aiState.stuckTimer = 0;
        } else if (dy !== 0 && !isColliding(newX, myRat.y)) {
            myRat.x = newX;
            myRat.aiState.stuckTimer = 0;
        } else {
            // Increment stuck timer if we couldn't move at all
            myRat.aiState.stuckTimer += 1;
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
                alertness: myRat.alertness,
                aiEnabled: myRat.aiEnabled
            },
            ratImageUrl: myRatImage.src
        });
    }
}

function updateRatAI(deltaTime, speed) {
    // Decide what to do based on current needs and surroundings
    const now = Date.now();

    // Make a new decision every 2 seconds, or when the goal has been achieved
    if (now - myRat.aiState.lastDecisionTime > 2000 || goalAchieved() || myRat.aiState.stuckTimer > 30) {
        // Make a decision based on current needs
        decideNextGoal();
        myRat.aiState.lastDecisionTime = now;
    }

    // Execute the current goal
    let dx = 0, dy = 0;

    switch (myRat.aiState.currentGoal) {
        case 'wander':
            // Basic wandering behavior - randomly change direction occasionally
            if (Math.random() < 0.02 || myRat.aiState.stuckTimer > 10) {
                myRat.aiState.wanderDirection = Math.random() * Math.PI * 2;
                myRat.aiState.stuckTimer = 0;
            }

            // Move in the current wander direction
            dx = Math.cos(myRat.aiState.wanderDirection) * speed * deltaTime;
            dy = Math.sin(myRat.aiState.wanderDirection) * speed * deltaTime;
            break;

        case 'seek_food':
        case 'seek_water':
            // If we have a target, move towards it
            if (myRat.aiState.targetX !== null && myRat.aiState.targetY !== null) {
                // Calculate global positions
                const globalTargetX = myRat.aiState.targetX + myRat.aiState.targetChunkX * chunkSize;
                const globalCurrentX = myRat.x + myRat.chunkX * chunkSize;
                const globalTargetY = myRat.aiState.targetY + myRat.aiState.targetChunkY * chunkSize;
                const globalCurrentY = myRat.y + myRat.chunkY * chunkSize;

                // Calculate direction to target
                const dirX = globalTargetX - globalCurrentX;
                const dirY = globalTargetY - globalCurrentY;
                const distance = Math.sqrt(dirX * dirX + dirY * dirY);

                if (distance > 5) { // Only move if we're not already at the target
                    dx = (dirX / distance) * speed * deltaTime;
                    dy = (dirY / distance) * speed * deltaTime;
                }
            } else {
                // No target, revert to wandering
                myRat.aiState.currentGoal = 'wander';
            }
            break;

        case 'flee':
            // If we have a flee target, move away from it
            if (myRat.aiState.fleeTarget) {
                // Calculate direction away from the threat
                const dirX = myRat.x - myRat.aiState.fleeTarget.x;
                const dirY = myRat.y - myRat.aiState.fleeTarget.y;
                const distance = Math.sqrt(dirX * dirX + dirY * dirY);

                if (distance > 0) {
                    dx = (dirX / distance) * speed * 1.5 * deltaTime; // Flee faster
                    dy = (dirY / distance) * speed * 1.5 * deltaTime;
                }

                // If we've fled far enough, stop fleeing
                if (distance > 300) {
                    myRat.aiState.currentGoal = 'wander';
                    myRat.aiState.fleeTarget = null;
                }
            } else {
                // No flee target, revert to wandering
                myRat.aiState.currentGoal = 'wander';
            }
            break;
    }

    // Move the rat according to the AI's decision
    moveRat(dx, dy);
}

function goalAchieved() {
    switch (myRat.aiState.currentGoal) {
        case 'wander':
            // Wandering doesn't have a completion condition
            return false;

        case 'seek_food':
            // Goal is achieved if energy is high enough
            return myRat.energy > 80;

        case 'seek_water':
            // Goal is achieved if hydration is high enough
            return myRat.hydration > 80;

        case 'flee':
            // Flee until the flee target is null or we're far enough away
            if (!myRat.aiState.fleeTarget) return true;

            const dx = myRat.x - myRat.aiState.fleeTarget.x;
            const dy = myRat.y - myRat.aiState.fleeTarget.y;
            const distance = Math.sqrt(dx * dx + dy * dy);
            return distance > 300;

        default:
            return false;
    }
}

function decideNextGoal() {
    // Check for nearby threats first (high priority)
    const nearbyThreats = findNearbyThreats();
    if (nearbyThreats.length > 0 && myRat.alertness > 30) {
        // Choose the closest threat to flee from
        const closestThreat = nearbyThreats[0];
        myRat.aiState.currentGoal = 'flee';
        myRat.aiState.fleeTarget = closestThreat;
        return;
    }

    // Check critical needs next
    if (myRat.energy < 30) {
        // Critical energy need - find food
        const foodTarget = findNearestResource('food');
        if (foodTarget) {
            myRat.aiState.currentGoal = 'seek_food';
            myRat.aiState.targetX = foodTarget.x;
            myRat.aiState.targetY = foodTarget.y;
            myRat.aiState.targetChunkX = foodTarget.chunkX;
            myRat.aiState.targetChunkY = foodTarget.chunkY;
            return;
        }
    }

    if (myRat.hydration < 30) {
        // Critical hydration need - find water
        const waterTarget = findNearestResource('water');
        if (waterTarget) {
            myRat.aiState.currentGoal = 'seek_water';
            myRat.aiState.targetX = waterTarget.x;
            myRat.aiState.targetY = waterTarget.y;
            myRat.aiState.targetChunkX = waterTarget.chunkX;
            myRat.aiState.targetChunkY = waterTarget.chunkY;
            return;
        }
    }

    // Check moderate needs
    if (myRat.energy < 50 && Math.random() < 0.7) {
        // Moderate energy need - consider finding food
        const foodTarget = findNearestResource('food');
        if (foodTarget) {
            myRat.aiState.currentGoal = 'seek_food';
            myRat.aiState.targetX = foodTarget.x;
            myRat.aiState.targetY = foodTarget.y;
            myRat.aiState.targetChunkX = foodTarget.chunkX;
            myRat.aiState.targetChunkY = foodTarget.chunkY;
            return;
        }
    }

    if (myRat.hydration < 50 && Math.random() < 0.7) {
        // Moderate hydration need - consider finding water
        const waterTarget = findNearestResource('water');
        if (waterTarget) {
            myRat.aiState.currentGoal = 'seek_water';
            myRat.aiState.targetX = waterTarget.x;
            myRat.aiState.targetY = waterTarget.y;
            myRat.aiState.targetChunkX = waterTarget.chunkX;
            myRat.aiState.targetChunkY = waterTarget.chunkY;
            return;
        }
    }

    // If we get here, just wander around
    myRat.aiState.currentGoal = 'wander';
    // Occasionally change wander direction
    if (Math.random() < 0.3) {
        myRat.aiState.wanderDirection = Math.random() * Math.PI * 2;
    }
}

function findNearbyThreats() {
    const threats = [];

    // Check for other rats that are too close
    for (const clientId in playerRats) {
        const rat = playerRats[clientId];

        // Calculate global positions
        const globalRatX = rat.x + rat.chunkX * chunkSize;
        const globalMyX = myRat.x + myRat.chunkX * chunkSize;
        const globalRatY = rat.y + rat.chunkY * chunkSize;
        const globalMyY = myRat.y + myRat.chunkY * chunkSize;

        // Calculate distance
        const dx = globalRatX - globalMyX;
        const dy = globalRatY - globalMyY;
        const distance = Math.sqrt(dx * dx + dy * dy);

        // If the rat is close and our alertness is high, consider it a threat
        if (distance < 100) {
            threats.push({
                x: globalRatX,
                y: globalRatY,
                distance: distance
            });
        }
    }

    // Sort threats by distance
    threats.sort((a, b) => a.distance - b.distance);

    return threats;
}

function findNearestResource(type) {
    let nearestResource = null;
    let nearestDistance = Infinity;

    // Check the current chunk and adjacent chunks
    const chunksToCheck = [
        `${myRat.chunkX},${myRat.chunkY}`,
        `${myRat.chunkX-1},${myRat.chunkY}`,
        `${myRat.chunkX+1},${myRat.chunkY}`,
        `${myRat.chunkX},${myRat.chunkY-1}`,
        `${myRat.chunkX},${myRat.chunkY+1}`
    ];

    for (const chunkId of chunksToCheck) {
        if (resourceSpawns[chunkId]) {
            const resources = resourceSpawns[chunkId].filter(r => r.type === type);
            const [chunkX, chunkY] = chunkId.split(',').map(Number);

            for (const resource of resources) {
                // Calculate global positions
                const globalResourceX = resource.x + chunkX * chunkSize;
                const globalMyX = myRat.x + myRat.chunkX * chunkSize;
                const globalResourceY = resource.y + chunkY * chunkSize;
                const globalMyY = myRat.y + myRat.chunkY * chunkSize;

                // Calculate distance
                const dx = globalResourceX - globalMyX;
                const dy = globalResourceY - globalMyY;
                const distance = Math.sqrt(dx * dx + dy * dy);

                if (distance < nearestDistance) {
                    nearestDistance = distance;
                    nearestResource = {
                        x: resource.x,
                        y: resource.y,
                        chunkX: chunkX,
                        chunkY: chunkY,
                        value: resource.value
                    };
                }
            }
        }
    }

    // If we found a resource, remember its location
    if (nearestResource) {
        const resourceKey = `${type}_${nearestResource.chunkX}_${nearestResource.chunkY}_${Math.floor(nearestResource.x)}_${Math.floor(nearestResource.y)}`;
        myRat.aiState.memoryMap[resourceKey] = {
            type: type,
            x: nearestResource.x,
            y: nearestResource.y,
            chunkX: nearestResource.chunkX,
            chunkY: nearestResource.chunkY,
            lastSeen: Date.now()
        };
    }

    return nearestResource;
}

function checkResourceCollection() {
    const currentChunkId = `${myRat.chunkX},${myRat.chunkY}`;
    const resources = resourceSpawns[currentChunkId];

    if (!resources) return;

    // Check for collision with resources
    for (let i = resources.length - 1; i >= 0; i--) {
        const resource = resources[i];
        const dx = myRat.x - resource.x;
        const dy = myRat.y - resource.y;
        const distance = Math.sqrt(dx * dx + dy * dy);

        // If the rat is close enough to the resource, collect it
        if (distance < RAT_SIZE / 2 + 15) { // Resource radius is approximately 15
            if (resource.type === 'food') {
                // Collect food (cheese) - increase energy
                myRat.energy = Math.min(100, myRat.energy + resource.value);

                // Remove the resource
                resources.splice(i, 1);

                // Update the database
                room.collection('resources').update(currentChunkId, {
                    resources: resources
                });

                // Reset target if this was our target
                if (myRat.aiState.currentGoal === 'seek_food' && 
                    myRat.aiState.targetX === resource.x && 
                    myRat.aiState.targetY === resource.y && 
                    myRat.aiState.targetChunkX === myRat.chunkX && 
                    myRat.aiState.targetChunkY === myRat.chunkY) {
                    myRat.aiState.targetX = null;
                    myRat.aiState.targetY = null;
                }
            } else if (resource.type === 'water') {
                // Collect water - increase hydration
                myRat.hydration = Math.min(100, myRat.hydration + resource.value);

                // Remove the resource
                resources.splice(i, 1);

                // Update the database
                room.collection('resources').update(currentChunkId, {
                    resources: resources
                });

                // Reset target if this was our target
                if (myRat.aiState.currentGoal === 'seek_water' && 
                    myRat.aiState.targetX === resource.x && 
                    myRat.aiState.targetY === resource.y && 
                    myRat.aiState.targetChunkX === myRat.chunkX && 
                    myRat.aiState.targetChunkY === myRat.chunkY) {
                    myRat.aiState.targetX = null;
                    myRat.aiState.targetY = null;
                }
            }
        }
    }
}

// ... existing code ...

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

                // Render resources in this chunk
                if (resourceSpawns[chunkId]) {
                    renderResources(resourceSpawns[chunkId], x, y);
                }
            }
        }
    }

    // Render all rats
    renderRats();

    // Render AI debug info if enabled
    if (myRat.aiEnabled) {
        renderAIDebugInfo();
    }
}

function renderResources(resources, chunkX, chunkY) {
    const offsetX = chunkX * chunkSize - cameraX;
    const offsetY = chunkY * chunkSize - cameraY;

    for (const resource of resources) {
        const x = offsetX + resource.x - 15; // Resource is approximately 30x30
        const y = offsetY + resource.y - 15;

        if (resource.type === 'food') {
            // Draw cheese
            if (cheeseImage && cheeseImage.complete) {
                ctx.drawImage(cheeseImage, x, y, 30, 30);
            } else {
                // Fallback if image not loaded
                ctx.fillStyle = '#ffc107';
                ctx.beginPath();
                ctx.arc(x + 15, y + 15, 15, 0, Math.PI * 2);
                ctx.fill();
            }
        } else if (resource.type === 'water') {
            // Draw water drop
            if (waterImage && waterImage.complete) {
                ctx.drawImage(waterImage, x, y, 30, 30);
            } else {
                // Fallback if image not loaded
                ctx.fillStyle = '#2196f3';
                ctx.beginPath();
                ctx.arc(x + 15, y + 15, 15, 0, Math.PI * 2);
                ctx.fill();
            }
        }
    }
}

function renderAIDebugInfo() {
    // Draw the current goal text
    ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
    ctx.fillRect(20, canvas.height - 50, 200, 30);
    ctx.fillStyle = 'white';
    ctx.font = '14px Arial';
    ctx.textAlign = 'left';
    ctx.fillText(`AI Goal: ${myRat.aiState.currentGoal}`, 30, canvas.height - 30);

    // Draw target indicator if there is one
    if ((myRat.aiState.currentGoal === 'seek_food' || myRat.aiState.currentGoal === 'seek_water') && 
        myRat.aiState.targetX !== null && myRat.aiState.targetY !== null) {

        // Calculate screen position of target
        const targetScreenX = myRat.aiState.targetX + myRat.aiState.targetChunkX * chunkSize - cameraX;
        const targetScreenY = myRat.aiState.targetY + myRat.aiState.targetChunkY * chunkSize - cameraY;

        // Draw line to target
        ctx.strokeStyle = myRat.aiState.currentGoal === 'seek_food' ? '#ffc107' : '#2196f3';
        ctx.lineWidth = 2;
        ctx.setLineDash([5, 5]);
        ctx.beginPath();
        ctx.moveTo(canvas.width / 2, canvas.height / 2);
        ctx.lineTo(targetScreenX, targetScreenY);
        ctx.stroke();
        ctx.setLineDash([]);

        // Draw target circle
        ctx.fillStyle = myRat.aiState.currentGoal === 'seek_food' ? 'rgba(255, 193, 7, 0.5)' : 'rgba(33, 150, 243, 0.5)';
        ctx.beginPath();
        ctx.arc(targetScreenX, targetScreenY, 15, 0, Math.PI * 2);
        ctx.fill();
    }

    // Draw flee direction if fleeing
    if (myRat.aiState.currentGoal === 'flee' && myRat.aiState.fleeTarget) {
        // Calculate screen position of flee target
        const fleeScreenX = myRat.aiState.fleeTarget.x - cameraX;
        const fleeScreenY = myRat.aiState.fleeTarget.y - cameraY;

        // Draw line from flee target
        ctx.strokeStyle = '#f44336';
        ctx.lineWidth = 2;
        ctx.setLineDash([5, 5]);
        ctx.beginPath();
        ctx.moveTo(fleeScreenX, fleeScreenY);
        ctx.lineTo(canvas.width / 2, canvas.height / 2);
        ctx.stroke();
        ctx.setLineDash([]);

        // Draw warning symbol at flee target
        ctx.fillStyle = 'rgba(244, 67, 54, 0.5)';
        ctx.beginPath();
        ctx.arc(fleeScreenX, fleeScreenY, 15, 0, Math.PI * 2);
        ctx.fill();
    }
}

// ... existing code ...

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

// Start the game when the page loads
window.addEventListener('load', initGame);