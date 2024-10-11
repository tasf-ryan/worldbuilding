// Extend the base Actor document
class MyCustomActor extends Actor {
  prepareData() {
    super.prepareData();
    
    // Ensure the actor has the necessary attributes
    this.system.attributes = this.system.attributes || {};
    this.system.attributes.main = this.system.attributes.main || {};
    
    // Initialize attributes if they don't exist
    ['str', 'dex', 'pre'].forEach(attr => {
      this.system.attributes.main[attr] = this.system.attributes.main[attr] || { value: 1 };
    });
  }

  async rollAttribute(attributeName) {
    const attrLower = attributeName.toLowerCase();
    const attrUpper = attributeName.toUpperCase();
    const level = this.system.attributes.main[attrLower].value;
    const numDice = Math.ceil((level + 1) / 2);
    const isOddLevel = level % 2 === 1;

    const roll = new Roll(`${numDice}d6`);
    await roll.evaluate({ async: true });
    
    if (game.dice3d) {
      await game.dice3d.showForRoll(roll);
    }

    const flatRolls = roll.dice[0].results.map(r => r.result);
    let content = this.formatRollContent(attrUpper, numDice, flatRolls, isOddLevel);

    // Check for special conditions (double 5s, double 6s)
    if (level >= 4) {
      const hasDoubleFive = flatRolls.filter(r => r === 5).length >= 2;
      const hasDoubleSix = flatRolls.filter(r => r === 6).length >= 2;
      content += this.getSpecialEffectsMessage(hasDoubleFive, hasDoubleSix);
    }

    // Create chat message
    await ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor: this }),
      content: content,
      type: CONST.CHAT_MESSAGE_TYPES.ROLL
    });

    // Update journal if a 6 was rolled
    if (flatRolls.includes(6)) {
      await this.updateJournalEntry(flatRolls, attrUpper);
    }

    return roll;
  }

  formatRollContent(attributeName, numDice, flatRolls, isOddLevel) {
    let content = `Rolled <b>${attributeName}</b> (${numDice}d6): ${flatRolls.map(roll => this.formatRollResult(roll)).join(", ")}`;

    if (isOddLevel) {
      const modifiedRolls = flatRolls.map(r => r + 1);
      content += `<br>+ With bonus: ${modifiedRolls.map(roll => this.formatRollResult(roll, true)).join(", ")}`;
    }

    return content;
  }

  formatRollResult(rollValue, isModified = false) {
    if (rollValue === 1) {
      return `<span style="color: red; font-weight: bold;">${rollValue}</span>`;
    } else if (rollValue === 6 && !isModified) {
      return `<span style="color: green; font-weight: bold;">${rollValue}</span>`;
    } else if (rollValue >= 5) {
      return `<span style="color: forestgreen;">${rollValue}</span>`;
    } else {
      return `<span style="color: darkorange;">${rollValue}</span>`;
    }
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

// Example usage:
// handleAttributeRoll('str'); // Roll Strength
// handleAttributeRoll('dex'); // Roll Dexterity
// handleAttributeRoll('pre'); // Roll Presence
