// TODO: License?
"use strict";

// Level
// - has 7 bolts, each 4 in height
// - has 5 colours of nut, 4x each (two bolts empty)
// - one 1h bolt (for cost)
// - Some levels have hidden the colours of all nuts you can't see from the top.
//    - Possibly more difficult to craft the puzzle, or perhaps they just allow the randomness (like minesweeper)
// - Starting L19, 9 bolts (still 4h) 7 colours (still maintaining colours = bolts - 2)
// - L21 back to 7b 4h 5c for some reason?
class Level {
  #bolts;
  #movesTaken;
  #dom;
  #score;
  #undo;
  constructor(aNumBolts = 7, aBoltHeight = 4, aNumColours = 5) {
    this.#bolts = new Array();
    this.#movesTaken = 0;
    this.#dom = document.createElement("div");
    this.#dom.gameobj = this;
    this.#dom.className = "level";
    for (let i = 0; i < aNumBolts; i++) {
      const bolt = new Bolt(aBoltHeight);
      this.#bolts.push(bolt);
      bolt.dom.addEventListener("click", this.#onclick.bind(this));
      this.#dom.appendChild(bolt.dom);
    }
    // assert: aNumColours < Object.keys(Colour.COLOURS).length
    let colours = Object.keys(Colour.COLOURS).slice(0, aNumColours);
    let allNuts = [];
    for (let h = 0; h < aBoltHeight; h++) {
      for (let c = 0; c < aNumColours; c++) {
        // Apply this nut to a random bolt.
        let boltIdx = Math.floor(Math.random() * aNumColours);
        for (let b = 0; b < aNumColours; b++) {
          // If the random bolt's full, try the next ones.
          const bolt = this.#bolts[(boltIdx + b) % aNumColours];
          if (bolt.nuts.length < aBoltHeight) {
            bolt.addNut(colours[c]);
            break;
          }
        }
      }
    }
    this.#score = new Score();
    this.#undo = new Array();
    document.getElementById("undo").classList.add("disabled");
    document.getElementById("new-game").classList.add("disabled");
    console.info(`New level aNumBolts ${aNumBolts}, aBoltHeight ${aBoltHeight}: ${JSON.stringify(this.#bolts)}`);
    console.info(`Score criteria: ${this.#score}.`);
  }

  get dom() {
    return this.#dom;
  }

  /** A user clicked on something.
    * Registered and dispatched here because only the Level knows enough of the state to make decisions.
    */
  #onclick(ev) {
    console.info(`Level onclick on ${ev.currentTarget.className}.`);
    // There are no elements on the field whose default actions should be taken.
    // Should prevent double-tap-to-zoom and stuff.
    ev.preventDefault();

    if (!(ev.currentTarget.gameobj instanceof Bolt)) {
      console.error(`Unknown gameobj on element ${ev.currentTarget.className}.`);
      return;
    }
    this.#onboltclick(ev.currentTarget.gameobj);
  }

  #onboltclick(aBolt) {
    // Bolt state machine:
    // Click on bolt when no selected bolt? Select clicked bolt
    // Click on a selected bolt? Deselect selected (and clicked) bolt
    // Click on bolt when selected bolt? Attempt move, deselect selected bolt
    if (this.#bolts.every(bolt => !bolt.selected)) {
      console.info(`No selected bolt. Selecting bolt ${aBolt}.`);
      aBolt.select();
      return;
    }
    if (aBolt.selected) {
      console.info(`Click on selected bolt. Deselecting bolt ${aBolt}.`);
      aBolt.deselect();
      return;
    }
    console.info(`Click on unselected bolt ${aBolt}.`);
    const selectedBolts = this.#bolts.filter(bolt => bolt.selected);
    console.info(`There are ${selectedBolts.length} selected bolts.`);
    // ensure: exactly one selected bolt
    selectedBolts.slice(1).forEach(bolt => bolt.deselect());
    const selectedBolt = selectedBolts[0];

    // Clone current state in case we need to add it to undo.
    let clonebolts = this.#bolts.map(bolt => bolt.clone());

    const moved = Bolt.move(selectedBolt, aBolt);
    console.info(`Move taken? ${moved}. Deselecting ${selectedBolt}.`);
    selectedBolt.deselect();

    if (moved) {
      this.#undo.push(clonebolts);
      document.getElementById("undo").classList.remove("disabled");
      this.#score.moveTaken();
      if (this.#bolts.every(bolt => { return bolt.isEmpty() || bolt.isComplete(); })) {
        console.info(`You are winner! ${JSON.stringify(this.#bolts)}`);
        this.#onwin();
      }
    }
  }

  #onwin() {
    this.#undo.length = 0;
    document.getElementById("undo").classList.add("disabled");
    const levelScore = this.#score.onwin();
    localStorage.setItem("game.score", levelScore + parseInt(localStorage.getItem("game.score") ?? 0));
    updateGameScoreUI();
    document.getElementById("new-game").classList.remove("disabled");
  }

  undo() {
    const prevBolts = this.#undo.pop();
    if (!prevBolts) {
      console.warn(`What? No undo, but undoing. ${JSON.stringify(this.#undo)}.`);
      return;
    }
    if (!this.#undo.length) {
      // No more undo, disable button.
      document.getElementById("undo").classList.add("disabled");
    }
    for (let i = 0; i < this.#bolts.length; i++) {
      this.#bolts[i].restoreFrom(prevBolts[i]);
    }
    // Deliberately leaving the movestaken increase.
  }

  /**
   * I don't know if every level is solveable.
   * But I know how to write a solver, and for a typical 7b4h5c map it should even be quick
   * since each step has at most 42 moves, and steps are guaranteed to move closer to a solution
   * (so long as we avoid moving an entire bolt to another empty bolt).
   * Uh, whoops, there are cycles because of partial stack moves.
   * Which means an exhaustive search of the solution space. 42 moves at each level, each move results in 42 available moves. At 20 depth that's > 10**32.
   * Exhaustive's to be avoided.
   * Takes 6s on my overbuilt Linux machine to run this.
   */
  solveable() {
    // Depth-first, brute-force solver.
    // Operate on a clone.
    let bolts = this.#bolts.map(bolt => bolt.clone());
    let moves = [];
    let solution = [];
    Level.solverStates = new Map();
    if (Level.solve(bolts, moves, solution)) {
      console.info(`Found ${solution.length}-move solution over ${Level.solverStates.size} game states: ${JSON.stringify(solution)}`);
      Level.solverStates = undefined; // Allow gc.
      return true;
    }
    console.info(`Unsolveable!`);
    return false;
  }

  static solverStates;
  static solverState(bolts) {
    return bolts.map(bolt => bolt.nuts.map(nut => nut.colour).join('')).join(',');
  }

  static solve(bolts, moves, solution) {
    const state = Level.solverState(bolts);
    const solvedMoves = Level.solverStates.get(state);
    if (solvedMoves && solvedMoves.length <= moves.length) {
      console.info(`Got to this state no slower already ${solvedMoves.length} <= ${moves.length}. Nothing to be gained.`);
      return false;
    }
    Level.solverStates.set(state, moves);
    if (solution.length && moves.length >= solution.length) {
      console.info(`Already found a better solution at depth ${solution.length}.`);
      return false;
    }
    if (bolts.every(bolt => { return bolt.isEmpty() || bolt.isComplete(); })) {
      console.info(`Solved with ${moves.length} moves ${JSON.stringify(moves)}.`);
      if (!moves.length || !solution.length || moves.length < solution.length) {
        console.info(`New best: ${solution.length} -> ${moves.length}.`);
        solution.length = 0;
        solution.push.apply(solution, moves);
      }
      return true;
    }
    let bestMoves;
    for (let i = 0; i < bolts.length; i++) {
      for (let j = 0; j < bolts.length; j++) {
        if (!Bolt.canMove(bolts[i], bolts[j], false /* allowUselessMoves */)) {
          continue;
        }
        let clonebolts = bolts.map(bolt => bolt.clone());
        Bolt.move(clonebolts[i], clonebolts[j], true /* skipDOMStuff */);
        moves.push([i, j]);
        console.info(`Testing path (length: ${moves.length}, solution: ${solution.length}): ${JSON.stringify(moves)}.`);
        Level.solve(clonebolts, moves, solution);
        moves.pop();
      }
    }
    if (!!solution.length) {
      // This is the best solution we've found down this path.
      console.info(`Best solution down this path: ${JSON.stringify(solution)}.`);
      return true;
    }
    // No good solution down this path.
    return false;
  }
}

class Bolt {
  #height;
  #enabled;
  #nuts; // Array at most `#height` in length, first element is the _top_ element.
  #selected;
  #dom;
  constructor(aHeight = 4, aEnabled = true) {
    this.#height = aHeight;
    this.#enabled = aEnabled;
    this.#nuts = new Array();
    this.#selected = false;
    this.#dom = document.createElement("div");
    this.#dom.className = "bolt";
    this.#dom.gameobj = this;
  }

  // Non-dom, non-selectedness cloning
  clone() {
    let clone = new Bolt(this.#height, this.#enabled);
    clone.#nuts = this.#nuts.map(nut => nut.clone());
    return clone;
  }

  restoreFrom(anotherBolt) {
    // Assert height
    this.#dom.innerHTML = ""; // fastest removeAllChildren
    this.#nuts = new Array();
    anotherBolt.#nuts.reverse().forEach(nut => {
      this.addNut(nut.colour);
    });
  }

  get nuts() {
    return this.#nuts;
  }

  toString() {
    return `{${this.#height}h, ${this.#nuts}}`;
  }

  toJSON() {
    return this.toString();
  }

  get dom() {
    return this.#dom;
  }

  createNuts(aNutColours) {
    // assert aNutColours.length <= this.#height
    // assert this.#nuts.length = 0
    // assert this.#dom has no element children
    aNutColours.forEach(colour => addNut(colour));
  }

  addNut(aColour) {
    // assert this.#nuts.length < this.#height
    const nut = new Nut(aColour);
    this.#nuts.unshift(nut);
    this.#dom.appendChild(nut.dom);
  }

  isEmpty() {
    return !this.#nuts.length;
  }

  isComplete() {
    if (this.isEmpty()) {
      return false;
    }
    const colour = this.#nuts[0].colour;
    return this.#nuts.length == this.#height && this.#nuts.every(nut => colour == nut.colour);
  }

  get selected() {
    return this.#selected;
  }

  /** e.g. User tapped on us and no other bolt was selected */
  select() {
    if (this.isEmpty() || this.#selected) {
      console.info(`Not selecting because empty? ${this.isEmpty()} selected? ${this.#selected}.`);
      return; // nothing to do
    }
    const topColour = this.#nuts[0].colour;
    if (this.#nuts.length == this.#height && this.#nuts.every(nut => topColour == nut.colour)) {
      console.info(`Not selecting because all ${this.#height} nuts are ${topColour}.`);
      return;
    }
    this.#selected = true;

    this.#nuts.every(nut => {
      if (nut.colour == topColour) {
        nut.select();
        return true;
      }
      return false;
    });
    console.info(`Nuts of colour ${topColour} selected on ${this}.`);
  }

  /** e.g. User tapped an empty space or asked for illegal move **/
  deselect() {
    if (!this.#selected) {
      console.info(`Not deselecting because empty? ${this.isEmpty()} selected? ${this.#selected}.`);
      return; // nothing to do
    }
    this.#selected = false;

    this.#nuts.forEach(nut => nut.deselect());
    console.info(`Bolt ${this} deselected.`);
  }

  static canMove(srcBolt, destBolt, allowUselessMoves) {
    if (srcBolt == destBolt) {
      console.info(`canMove: srcBolt == destBolt.`);
      return false;
    }
    if (!srcBolt.#nuts.length) {
      console.info(`canMove: No nuts on srcBolt ${srcBolt}.`);
      return false;
    }
    if (destBolt.#nuts.length == destBolt.#height) {
      console.info(`canMove: No room on destBolt ${destBolt}.`);
      return false;
    }
    const srcNut = srcBolt.#nuts[0];
    const destNut = destBolt.#nuts[0];
    if (!!destNut && srcNut.colour != destNut.colour) {
      console.info(`canMove: Colour mismatch ${srcNut} <> ${destNut}.`);
      return false;
    }
    if (!allowUselessMoves) {
      // Though a legal game move, the solver would loop moving a whole
      // stack back and forth between an empty bolt.
      const topSrcColour = srcBolt.#nuts[0].colour;
      if (!destBolt.#nuts.length && srcBolt.#nuts.every(nut => topSrcColour == nut.colour)) {
        console.info(`canMove: Move wouldn't get closer to a solution.`);
        return false;
      }
      // Though a legal game move, moving only partial stacks causes solver loops.
      // Also, it's unclear whether it ever gets you closer to a solution.
      const destinationSpace = destBolt.#height - destBolt.#nuts.length;
      const srcStackHeight = srcBolt.#nuts.findLastIndex(nut => nut.colour == srcNut.colour) + 1;
      if (srcStackHeight > destinationSpace) {
        console.info(`canMove: Move would only move part of a stack of size ${srcStackHeight}.`);
        return false;
      }
    }
    console.info(`canMove: Can move!`);
    return true;
  }

  /** Move all matching nuts from src to dest, if possible
    * @returns true if a move happened (even if not all nuts moved).
    */
  static move(srcBolt, destBolt, skipDOMStuff) {
    console.info(`Move from ${srcBolt} to ${destBolt} begin.`);
    // assert: srcBolt is selected, destBolt is not
    // assert: srcBolt isn't empty (can't be selected).
    let moved = false;
    for ( ;; ) {
      if (!Bolt.canMove(srcBolt, destBolt, true /* allowWholeBoltMove */)) {
        break;
      }
      const srcNut = srcBolt.#nuts[0];
      console.info(`${srcNut} is on the move!`);
      destBolt.#nuts.unshift(srcBolt.#nuts.shift());
      if (!skipDOMStuff) {
        srcBolt.#dom.removeChild(srcNut.dom);
        destBolt.#dom.appendChild(srcNut.dom);
      }
      srcNut.deselect();
      // TODO: Kick off some Animation or whatever
      moved = true;
    }
    console.info(`Move complete. Anything moved? ${moved}`);
    return moved;
  }
}

class Nut {
  #colour;
  #selected;
  #dom;
  constructor(aColour) {
    this.#colour = aColour;
    this.#selected = false;
    this.#dom = document.createElement("div");
    this.#dom.className = "nut";
    this.#dom.style.backgroundColor = Colour.COLOURS[aColour];
  }

  // non-DOM, non-selectedness cloning
  clone() {
    return new Nut(this.#colour);
  }

  toJSON() {
    return `${this.#colour}`;
  }

  toString() {
    return this.toJSON();
  }

  get dom() {
    return this.#dom;
  }

  get colour() {
    return this.#colour;
  }

  select() {
    this.#selected = true;
    this.#dom.classList.add("selected");
  }

  deselect() {
    this.#selected = false;
    this.#dom.classList.remove("selected");
  }
}

class Colour {
  // Ensure these are unique.
  static RED = "r";
  static GREEN = "g";
  static BLUE = "b";
  static YELLOW = "y";
  static GREY = "e";

  static COLOURS = {
    [Colour.RED]: "rgb(255, 0, 0)",
    [Colour.GREEN]: "rgb(0, 255, 0)",
    [Colour.BLUE]: "rgb(0, 0, 255)",
    [Colour.YELLOW]: "rgb(255, 255, 0)",
    [Colour.GREY]: "rgb(128, 128, 128)",
  };

  constructor() {
  }
}

// Score
// - Max of 3 stars available, shown on a line with extra space to the right
// - Each move decreases the bar, knocking out stars eventually
// - Lose the first star at ~ minmoves + 12?
// - Also get bolts for some reason, but those are for microtransactions of getting new bgs
// I _think_ it's based on minimum moves necessary to solve,
// but as `solveable` takes like multiple seconds to run,
// let's just say it takes 18 moves to solve any random puzzle
// (as that's the maximum min-moves-to-solve from five or six I looked at).
class Score {
  #minMoves;
  #movesTaken;
  #dom;
  constructor(aMinMoves = 18) {
    document.body.classList.remove("win");
    this.#minMoves = 18;
    this.#movesTaken = 0;
    this.#dom = document.getElementById("score");
    this.#dom.innerHTML = ""; // Fastest removeAllChildren
    // Score bar
    const outer = document.createElement("div");
    outer.className = "outer score-bar";
    const inner = document.createElement("div");
    inner.className = "inner score-bar";
    outer.appendChild(inner);
    this.#dom.appendChild(outer);
    for (let i = 0; i < 3; i++) {
      // Stars
      const star = document.createElement("div");
      star.className = "star";
      star.textContent = "★";
      outer.appendChild(star);
    }
    // Moves display
    const moves = document.createElement("div");
    moves.className = "moves";
    const text = document.createElement("span");
    text.textContent = "Moves taken: ";
    moves.appendChild(text);
    const numMoves = document.createElement("span");
    numMoves.id = "num-moves";
    numMoves.textContent = "0";
    moves.appendChild(numMoves);
    this.#dom.appendChild(moves);
  }

  moveTaken() {
    const starsBefore = this.#starsLeft();
    this.#movesTaken++;
    console.info(`Score.moveTaken: ${this.#movesTaken} moves taken.`);
    const numMoves = document.getElementById("num-moves");
    if (numMoves) {
      numMoves.textContent = this.#movesTaken;
    }
    // Score bar adjust
    // We want the inner bar to be 100% when #movesTaken == 0, and 50% when #movesTaken == #minMoves
    const widthPct = 50 + ((this.#minMoves - this.#movesTaken) / this.#minMoves * 50);
    const innerBar = document.querySelector(".inner.score-bar");
    if (innerBar) {
      innerBar.style.width = widthPct + "%";
    }
    // Stars adjust
    const starsAfter = this.#starsLeft();
    if (starsAfter < starsBefore) {
      // assert: starsAfter = starsBefore - 1
      const lostStar = document.querySelectorAll(".star")[starsAfter];
      lostStar.classList.add("lost");
    }
  }

  #starsLeft() {
    if (this.#movesTaken <= this.#minMoves) {
      return 3;
    }
    if (this.#movesTaken <= this.#minMoves * 1.5) {
      return 2;
    }
    if (this.#movesTaken <= this.#minMoves * 2) {
      return 1;
    }
    return 0;
  }

  /**
    * When you win, calculate the number of stars earned this level.
    */
  onwin() {
    document.body.classList.add("win");
    return this.#starsLeft();
  }
}

// Special Level
// - N bolts, 3 in height
// - N - 2 colours of nut, 3x each
// - except SL2 had N - 1 colours
// - SL3 had 3x bolts of 3 colours, 8h + 3x empty bolts 3h

function updateGameScoreUI() {
  document.getElementById("game-score-number").textContent = localStorage.getItem("game.score") ?? 0;
}

function newLevel() {
  document.querySelector(".level").replaceWith(new Level().dom);
};

document.getElementById("new-game").addEventListener("click", newLevel);

document.getElementById("undo").addEventListener("click", () => {
  document.querySelector(".level").gameobj?.undo();
});

updateGameScoreUI();
newLevel();
