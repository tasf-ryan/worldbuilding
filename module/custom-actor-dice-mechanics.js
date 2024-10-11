// Extend the base Actor document
class MyCustomActor extends Actor {
  prepareData() {
    super.prepareData();
    
    // Ensure the actor has the necessary attributes
    this.system.attributes = this.system.attributes || {};
    this.system.attributes.main = this.system.attributes.main || {};
    
    // Initialize attributes if they don't exist
    ['str', 'dex', 'pre', 'x'].forEach(attr => {
      this.system.attributes.main[attr] = this.system.attributes.main[attr] || { value: 1 };
    });

    // Initialize X activation flag
    this.system.xActivated = this.system.xActivated || false;
  }

  async rollAttribute(attributeName) {
    const attrLower = attributeName.toLowerCase();
    const attrUpper = attributeName.toUpperCase();
    const baseLevel = this.system.attributes.main[attrLower]?.value || 1;
    const xLevel = this.system.attributes.main.x?.value || 1;

    // Determine if this is a hybrid roll
    const isHybridRoll = this.canUseHybridRoll(baseLevel, xLevel);

    let baseDice, xDice;
    if (isHybridRoll) {
      ({ baseDice, xDice } = this.calculateHybridDice(baseLevel, xLevel));
    } else {
      baseDice = Math.ceil((baseLevel + 1) / 2);
      xDice = 0;
    }

    // Perform the rolls
    const baseRoll = await new Roll(`${baseDice}d6`).evaluate({async: true});
    const xRoll = isHybridRoll ? await new Roll(`${xDice}d6`).evaluate({async: true}) : null;

    // Display 3D dice if game.dice3d is available
    if (game.dice3d) {
      await game.dice3d.showForRoll(baseRoll, game.user, true);
      if (xRoll) {
        await game.dice3d.showForRoll(xRoll, game.user, true, null, false, {
          colorset: "custom_x_dice" // You'd need to define this in your Dice So Nice settings
        });
      }
    }

    const baseFlatRolls = baseRoll.dice[0].results.map(r => r.result);
    const xFlatRolls = xRoll ? xRoll.dice[0].results.map(r => r.result) : [];
    const combinedRolls = baseFlatRolls.concat(xFlatRolls);

    let content = this.formatRollContent(attrUpper, baseFlatRolls, xFlatRolls);

    // Check for special conditions (double 5s, double 6s)
    if (baseLevel >= 4) {
      const hasDoubleFive = combinedRolls.filter(r => r === 5).length >= 2;
      const hasDoubleSix = combinedRolls.filter(r => r === 6).length >= 2;
      content += this.getSpecialEffectsMessage(hasDoubleFive, hasDoubleSix);
    }

    // Create chat message
    await ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor: this }),
      content: content,
      type: CONST.CHAT_MESSAGE_TYPES.ROLL,
      rolls: [baseRoll, xRoll].filter(Boolean)
    });

    // Update journal entries separately for base and X rolls
    if (baseFlatRolls.includes(6)) {
      await this.updateJournalEntry(baseFlatRolls, attrUpper);
    }
    if (xFlatRolls.includes(6)) {
      await this.updateJournalEntry(xFlatRolls, 'X');
    }

    return { baseRoll, xRoll };
  }

  canUseHybridRoll(baseLevel, xLevel) {
    return this.system.xActivated && baseLevel >= 4 && xLevel >= 4;
  }

  calculateHybridDice(baseLevel, xLevel) {
    const totalBaseDice = Math.ceil((baseLevel + 1) / 2);
    const totalXDice = Math.ceil((xLevel + 1) / 2);
    
    let xDice = Math.min(
      Math.floor(totalBaseDice / 2),
      Math.floor(totalXDice / 2)
    );
    
    let baseDice = totalBaseDice - xDice;
    
    return { baseDice, xDice };
  }

  formatRollContent(attributeName, baseFlatRolls, xFlatRolls) {
    let content = `Rolled <b>${attributeName}</b>: ${baseFlatRolls.map(roll => this.formatRollResult(roll)).join(", ")}`;
    if (xFlatRolls.length > 0) {
      content += `<br>X Dice: ${xFlatRolls.map(roll => this.formatRollResult(roll, false, true)).join(", ")}`;
    }
    return content;
  }

  formatRollResult(rollValue, isModified = false, isXDie = false) {
    let color = rollValue === 1 ? 'red' :
                rollValue === 6 ? 'green' :
                rollValue >= 5 ? 'forestgreen' : 'darkorange';
    
    let style = `color: ${color}; font-weight: bold;`;
    if (isXDie) {
      style += ' text-decoration: underline;'; // or any other distinct style for X dice
    }
    
    return `<span style="${style}">${rollValue}</span>`;
  }

  getSpecialEffectsMessage(hasDoubleFive, hasDoubleSix) {
    let message = "";
    if (hasDoubleFive && hasDoubleSix) {
      message = "<br><span style='color: red; font-weight: bold;'>(CRITICAL)</span> <b>MANEUVER!</b>";
    } else if (hasDoubleFive) {
      message = "<br><b>MANEUVER!</b>";
    } else if (hasDoubleSix) {
      message = "<br><span style='color: red; font-weight: bold;'>CRITICAL MANEUVER!</span>";
    }
    return message;
  }

  async updateJournalEntry(flatRolls, attributeName) {
    const journal = game.journal.getName(this.name) || await JournalEntry.create({ name: this.name });

    let page = journal.pages.getName(attributeName);
    if (!page) {
      const createdPages = await journal.createEmbeddedDocuments("JournalEntryPage", [{ name: attributeName, text: { content: "" } }]);
      page = createdPages[0];
    }

    const now = new Date();
    const timestamp = now.toISOString().slice(0, 16).replace("T", " ");
    const newContent = `<br>[${timestamp}] Rolled: ${flatRolls.join(", ")}`;
    await page.update({ 'text.content': page.text.content + newContent });
  }

  // Method to toggle X activation
  toggleX() {
    const xLevel = this.system.attributes.main.x.value;
    if (xLevel >= 4) {
      this.system.xActivated = !this.system.xActivated;
      this.update({ 'system.xActivated': this.system.xActivated });
      ChatMessage.create({
        speaker: ChatMessage.getSpeaker({ actor: this }),
        content: `X ${this.system.xActivated ? 'activated' : 'deactivated'} for ${this.name}.`,
        type: CONST.CHAT_MESSAGE_TYPES.OTHER
      });
    } else {
      ui.notifications.warn("X level must be at least 4 to activate.");
    }
  }
}

// Register the custom Actor class
CONFIG.Actor.documentClass = MyCustomActor;

// Utility function to get available tokens
function getAvailableTokens() {
  if (game.user.isGM) {
    return canvas.tokens.placeables;
  } else {
    return canvas.tokens.placeables.filter(t => t.actor?.hasPlayerOwner && t.actor?.isOwner && !t.actor.effects.some(e => e.label === "Dead"));
  }
}

// Function to display dialog for token selection
async function selectTokenDialog(availableTokens) {
  const tokenChoices = availableTokens.map(t => `<option value="${t.id}">${t.name}</option>`).join("");
  return new Promise((resolve) => {
    new Dialog({
      title: "Select Token",
      content: `
        <p>Select the token you want to roll for:</p>
        <select id="token-select">${tokenChoices}</select>
      `,
      buttons: {
        roll: {
          label: "Roll",
          callback: (html) => resolve(canvas.tokens.get(html.find("#token-select").val())),
        },
      },
      default: "roll",
      close: () => resolve(null),
    }).render(true);
  });
}

// Function to handle attribute roll
async function handleAttributeRoll(attributeName) {
  let token = canvas.tokens.controlled[0];

  if (!token) {
    const availableTokens = getAvailableTokens();
    if (availableTokens.length === 0) {
      ui.notifications.warn("You do not own any active tokens!");
      return;
    } else if (availableTokens.length === 1) {
      token = availableTokens[0];
    } else {
      token = await selectTokenDialog(availableTokens);
    }
  }

  if (!token) {
    ui.notifications.warn("No token selected!");
    return;
  }

  await token.actor.rollAttribute(attributeName);
}

// Function to toggle X activation
function toggleXActivation() {
  let token = canvas.tokens.controlled[0];

  if (!token) {
    ui.notifications.warn("No token selected!");
    return;
  }

  token.actor.toggleX();
}

// Example usage:
// handleAttributeRoll('str'); // Roll Strength (possibly with X if conditions are met)
// handleAttributeRoll('dex'); // Roll Dexterity (possibly with X if conditions are met)
// handleAttributeRoll('pre'); // Roll Presence (possibly with X if conditions are met)
// handleAttributeRoll('x');   // Roll X directly
// toggleXActivation();        // Toggle X activation for the selected token
