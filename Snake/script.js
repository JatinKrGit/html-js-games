const canvas = document.getElementById("gameCanvas");
const context = canvas.getContext("2d");
const scoreElement = document.getElementById("score");
const statusElement = document.getElementById("status");
const restartButton = document.getElementById("restartButton");

const tileSize = 24;
const tileCount = canvas.width / tileSize;
const moveDelay = 110;

let snake;
let food;
let direction;
let nextDirection;
let score;
let gameOver;
let lastMoveTime;
let animationId;

function resetGame() {
  snake = [
    { x: 10, y: 10 },
    { x: 9, y: 10 },
    { x: 8, y: 10 }
  ];
  direction = { x: 1, y: 0 };
  nextDirection = { x: 1, y: 0 };
  score = 0;
  gameOver = false;
  lastMoveTime = 0;

  scoreElement.textContent = score;
  statusElement.textContent = "Use arrow keys to move";
  placeFood();

  cancelAnimationFrame(animationId);
  animationId = requestAnimationFrame(gameLoop);
}

function gameLoop(currentTime) {
  if (currentTime - lastMoveTime >= moveDelay) {
    updateGame();
    lastMoveTime = currentTime;
  }

  drawGame();

  if (!gameOver) {
    animationId = requestAnimationFrame(gameLoop);
  }
}

function updateGame() {
  direction = nextDirection;

  const head = snake[0];
  const newHead = {
    x: head.x + direction.x,
    y: head.y + direction.y
  };

  if (hitsWall(newHead) || hitsSnake(newHead, newHead.x === food.x && newHead.y === food.y)) {
    endGame();
    return;
  }

  snake.unshift(newHead);

  if (newHead.x === food.x && newHead.y === food.y) {
    score += 10;
    scoreElement.textContent = score;
    statusElement.textContent = "Food eaten";
    placeFood();
  } else {
    snake.pop();
  }
}

function drawGame() {
  clearCanvas();
  drawFood();
  drawSnake();

  if (gameOver) {
    drawGameOverMessage();
  }
}

function clearCanvas() {
  context.fillStyle = "#111827";
  context.fillRect(0, 0, canvas.width, canvas.height);

  // Draw subtle grid lines to make movement easier to track.
  context.strokeStyle = "#1f2937";
  context.lineWidth = 1;

  for (let position = tileSize; position < canvas.width; position += tileSize) {
    context.beginPath();
    context.moveTo(position, 0);
    context.lineTo(position, canvas.height);
    context.stroke();

    context.beginPath();
    context.moveTo(0, position);
    context.lineTo(canvas.width, position);
    context.stroke();
  }
}

function drawSnake() {
  snake.forEach((segment, index) => {
    context.fillStyle = index === 0 ? "#22c55e" : "#16a34a";
    context.fillRect(
      segment.x * tileSize + 2,
      segment.y * tileSize + 2,
      tileSize - 4,
      tileSize - 4
    );
  });
}

function drawFood() {
  context.fillStyle = "#ef4444";
  context.beginPath();
  context.arc(
    food.x * tileSize + tileSize / 2,
    food.y * tileSize + tileSize / 2,
    tileSize / 2 - 3,
    0,
    Math.PI * 2
  );
  context.fill();
}

function drawGameOverMessage() {
  context.fillStyle = "rgba(17, 24, 39, 0.76)";
  context.fillRect(0, 0, canvas.width, canvas.height);

  context.fillStyle = "#ffffff";
  context.textAlign = "center";
  context.font = "700 42px Arial";
  context.fillText("Game Over", canvas.width / 2, canvas.height / 2 - 12);

  context.font = "20px Arial";
  context.fillText("Press Restart to play again", canvas.width / 2, canvas.height / 2 + 28);
}

function placeFood() {
  do {
    food = {
      x: Math.floor(Math.random() * tileCount),
      y: Math.floor(Math.random() * tileCount)
    };
  } while (snake.some(segment => segment.x === food.x && segment.y === food.y));
}

function hitsWall(position) {
  return (
    position.x < 0 ||
    position.x >= tileCount ||
    position.y < 0 ||
    position.y >= tileCount
  );
}

function hitsSnake(position, isEatingFood) {
  const bodyToCheck = isEatingFood ? snake : snake.slice(0, -1);

  return bodyToCheck.some(segment => segment.x === position.x && segment.y === position.y);
}

function endGame() {
  gameOver = true;
  statusElement.textContent = "Game over";
}

function changeDirection(event) {
  const keyDirections = {
    ArrowUp: { x: 0, y: -1 },
    ArrowDown: { x: 0, y: 1 },
    ArrowLeft: { x: -1, y: 0 },
    ArrowRight: { x: 1, y: 0 }
  };

  const requestedDirection = keyDirections[event.key];

  if (!requestedDirection) {
    return;
  }

  event.preventDefault();

  // Prevent direct reversal into the snake body.
  if (
    requestedDirection.x + direction.x === 0 &&
    requestedDirection.y + direction.y === 0
  ) {
    return;
  }

  nextDirection = requestedDirection;
}

document.addEventListener("keydown", changeDirection);
restartButton.addEventListener("click", resetGame);

resetGame();
