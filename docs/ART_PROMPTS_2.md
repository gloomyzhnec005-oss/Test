# Промты, часть 2: существа, боссы, перегенерации, оформление

Копируйте блок целиком. Одна картинка — один промт. В сообщении подписывайте номер (С-1, Б-3, И-5…).
Если генератор нарисовал другое число кадров или перепутал ряды — не страшно, напишите, что где.

---

## С. Призванные существа (сейчас их рисует код)

Формат как у монстров: каждый ряд — одно существо, **смотрит вправо**, 4 кадра ходьбы + 3 кадра атаки.

### С-1: звери, скелет, двойник, турель (зелёный фон)

```
Pixel art fantasy RPG creature sprite sheet, Lineage 2 / Diablo pixel art style, top-down 3/4 view, same style as the heroes.
Pure bright green background (#00FF00), no text, no grid lines, no shadows on the ground.
Strict grid: 6 rows × 7 frames, all frames the same size, generous empty green space between frames, creatures never touch.
Every creature faces RIGHT. In each row: frames 1–4 = walk cycle, frames 5–7 = attack (wind-up, strike, recover).
Row 1 — spirit wolf companion: grey-silver wolf with glowing amber eyes and a faint green spirit aura; attack = lunging bite.
Row 2 — brown war bear companion: huge brown bear with leather harness and bone charms; attack = standing swipe with claws.
Row 3 — hunting falcon companion: brown-gold falcon flying low; attack = diving talon strike.
Row 4 — raised skeleton warrior servant: yellowed bones, rusty sword and broken shield, ghostly green fire in eye sockets; attack = sword slash.
Row 5 — illusion double of a masked sorceress: translucent pink-violet copy of a woman in a gold mask with a crystal staff, shimmering edges; attack = staff swing with pink sparkles.
Row 6 — dwarven steam turret: small brass-and-iron cannon turret on three legs with blue glowing core (it does not walk: frames 1–4 = idle rotation, frames 5–7 = firing with muzzle flash).
```

### С-2: духи природы, воды и душ (пурпурный фон — они зелёные и голубые)

```
Pixel art fantasy RPG creature sprite sheet, Lineage 2 / Diablo pixel art style, top-down 3/4 view, same style as the heroes.
Pure bright magenta background (#FF00FF), no text, no grid lines, no shadows on the ground.
Strict grid: 4 rows × 7 frames, all frames the same size, generous empty magenta space between frames, creatures never touch.
Every creature faces RIGHT. In each row: frames 1–4 = walk/float cycle, frames 5–7 = attack (wind-up, strike, recover).
Row 1 — forest spirit dryad: small woman made of living wood, leaves and pink flowers, glowing green eyes; attack = whipping vine.
Row 2 — sea spirit: horse made of swirling ocean water with foam mane and glowing blue eyes; attack = charging water splash.
Row 3 — drowned servant: pale blue-grey drowned sailor in torn clothes with seaweed, dripping water; attack = clawing grab.
Row 4 — soul guide spirit: hooded ghostly reaper of pale teal light holding a small lantern and scythe, floating; attack = scythe sweep with soul wisps.
```

---

## Б. Боссы данжей и мировые боссы (сейчас их рисует генератор)

Формат тот же: ряд — один босс, **смотрит вправо**, 4 кадра ходьбы + 3 кадра атаки. В каждом листе 3 босса.
Общая шапка (вставьте её перед описанием рядов в каждом из промтов Б-1…Б-7):

```
Pixel art fantasy RPG boss sprite sheet, Lineage 2 / Diablo pixel art style, top-down 3/4 view, same style as the heroes, big imposing bosses with rich detail.
Pure bright green background (#00FF00), no text, no grid lines, no ground shadows.
Strict grid: 3 rows × 7 frames, all frames the same size, generous empty green space between frames, bosses never touch.
Every boss faces RIGHT. In each row: frames 1–4 = walk cycle, frames 5–7 = attack (wind-up, strike, recover).
```

**Б-1** (мир I)
```
Row 1 — Troll Shaman: hunched green-grey troll with tusks, bone staff with skulls, feathers and voodoo totems; attack = staff slam with green magic.
Row 2 — Gryphon: eagle-headed lion with golden-brown feathers and huge wings; attack = wing-spread claw strike.
Row 3 — Skeleton King: tall skeleton in rusted crown and royal tattered cape, giant bone sword, blue ghost fire; attack = overhead sword cleave.
```

**Б-2** (мир I)
```
Row 1 — Orc Chief: massive green orc in spiked iron armor with a huge double axe and war paint; attack = axe swing.
Row 2 — Stone Titan: giant golem of mossy grey boulders with glowing amber runes; attack = ground-pound with both fists.
Row 3 — Dragon Whelp: young red-orange dragon, small wings, fiery belly; attack = fire breath burst.
```

**Б-3** (мир II)
```
Row 1 — Kraken: dark purple sea monster with many tentacles rising from a small pool of black water; attack = tentacle slam.
Row 2 — Cerberus: three-headed black hellhound with burning red eyes and fiery manes; attack = triple bite with flames.
Row 3 — Lich King: skeletal sorcerer in black-purple robes and ice crown, floating, with a frost staff; attack = casting a blue-violet frost spell.
```

**Б-4** (мир II)
```
Row 1 — Demon Lord: huge red-black demon with horns, bat wings and a flaming whip; attack = whip lash with fire.
Row 2 — Abyss Titan: colossal giant of black obsidian with purple cracks of void energy; attack = heavy punch with void shockwave.
Row 3 — Ancient Dragon: enormous dark green-bronze dragon with horns and torn wings; attack = biting lunge with smoke.
```

**Б-5** (мир III)
```
Row 1 — Phoenix: blazing golden-orange firebird with long flaming tail feathers; attack = fiery wing sweep.
Row 2 — Fallen Angel: dark angel in cracked white-gold armor with black feathered wings and a broken halo, holding a spear; attack = spear thrust with dark light.
Row 3 — Gorgon: snake-haired queen with a serpent tail, bronze armor and a bow; attack = petrifying green gaze burst.
```

**Б-6** (мир III и мировой босс мира I)
```
Row 1 — Lord of Chaos: armored warlord in jagged purple-black armor, cloak of storm clouds, two chaos blades; attack = double cross slash with lightning.
Row 2 — The Legion (world boss): a towering mass of armored skeletal soldiers fused into one giant with many shields and spears; attack = spear wall thrust.
Row 3 — The Devourer (world boss): bloated abyss beast with a huge fanged maw and many eyes, purple-black flesh; attack = gaping bite.
```

**Б-7** (мировые боссы миров II и III)
```
Row 1 — Avatar of the Abyss: giant shadow humanoid made of void and purple fire, with a crown of black spikes; attack = void palm strike.
Row 2 — Eternal Dragon: majestic white-gold celestial dragon with glowing blue runes and star-filled wings; attack = holy breath beam.
Row 3 — Chaos Titan: colossus of floating rock and storm with lightning veins and a ring of debris; attack = lightning slam.
```

---

## П. Перегенерации (на зелёном фоне камень слился)

### П-14b: Сердце леса и Руна жизни (пурпурный фон)

```
Fantasy MMORPG inventory item icons, hand-painted digital art in the style of Diablo and Lineage 2 item icons, ornate details, magical glow, 3/4 view, strong readable silhouette at 48 px, soft rim light, painterly texture, high detail.
Each object is isolated and centered in its own cell, fills about 80% of the cell, does not touch neighbours.
Flat solid pure magenta #FF00FF background everywhere, no shadows on the background, no text, no frame, no watermark.
One image with exactly 2 icons side by side, equal cells, generous empty space between them:
1) Heart of the Forest — a glowing emerald-green crystal heart wrapped in living roots and small leaves.
2) Rune of Life — a rounded stone rune with a bright green leaf glyph glowing in its center.
```

---

## И. Оформление интерфейса

### И-5: логотип игры (пурпурный фон)

```
Fantasy MMORPG game logo, ornate gold and dark iron lettering with glowing magic runes, a sword and crystal behind the text, Diablo / Lineage 2 style, high detail.
Text: "TELEGRAM QUEST" (exactly this spelling), two lines.
Centered, isolated on a flat solid magenta #FF00FF background, no other text, no watermark. Wide format 2:1.
```
*(сейчас игра называется «Telegram Quest» — если хотите другое название, замените текст в кавычках)*

### И-6: заставка загрузки (без вырезания, картинка целиком)

```
Fantasy MMORPG loading screen illustration, vertical phone format 9:16, painterly digital art in Diablo / Lineage 2 style.
Three worlds stacked from bottom to top: a sunny green valley town at the bottom, a dark abyss city with purple fire in the middle, a floating golden sky citadel among clouds at the top, connected by glowing portals.
A party of heroes (knight, mage, archer) seen from behind on a cliff in the foreground. Dramatic lighting, rich colors.
Leave the bottom 15% calmer and darker (a loading bar will be drawn there). No text, no logo, no watermark.
```

### И-7: рубашки карт призыва по редкости (зелёный фон)

```
Fantasy MMORPG summon card backs, hand-painted, ornate, Diablo / Lineage 2 style. Vertical cards 2:3.
One image with exactly 5 card backs in a row, equal size, generous empty space between them, flat solid pure green #00FF00 background, no text.
Each card: ornate border, a magic seal emblem in the center, glowing by rarity:
1) Common — grey stone and silver, faint glow.
2) Rare — blue enamel and silver, blue glow.
3) Epic — purple velvet and gold, violet glow with sparks.
4) Legendary — black and gold, orange-gold radiant glow, sun rays.
5) Mythic — crimson and gold with gems, red glow and floating crystals.
```

### И-8: рамки ячеек предметов по редкости (пурпурный фон)

```
Fantasy MMORPG inventory slot frames, square, hand-painted ornate metal frames, Diablo / Lineage 2 style.
One image with exactly 5 square frames in a row, equal size, generous space between them, flat solid magenta #FF00FF background. The CENTER of each frame is EMPTY and also magenta (hollow frame), no items inside, no text.
1) Common — plain dark iron.  2) Rare — silver with blue gems.  3) Epic — gold with purple gems.  4) Legendary — ornate gold with orange glow.  5) Mythic — gold and crimson with red glowing crystals.
```

### И-8b: тонкие рамки ячеек (замена И-8 — прежние закрывали предмет)

```
Fantasy MMORPG inventory slot frames, square, hand-painted thin ornate metal frames, Diablo / Lineage 2 style.
One image with exactly 5 square frames in a row, equal size, generous empty space between them (frames never touch), flat solid magenta #FF00FF background.
Each frame is a THIN border: the border band is only about 6% of the frame width, with small decorations ONLY on the four corners and pointing OUTWARD.
Nothing points inward: no spikes, gems or ornaments inside the frame. The whole inner area (about 88% of the frame) is EMPTY and magenta, no items, no text.
1) Common — thin dark iron band, tiny iron corner rivets.
2) Rare — thin silver band, small blue gem on each corner.
3) Epic — thin gold band, small purple gem on each corner.
4) Legendary — thin ornate gold band with a soft orange glow, small amber gem on each corner.
5) Mythic — thin gold and crimson band, small glowing red crystal on each corner.
```

### И-9: фон экрана персонажа (без вырезания)

```
Fantasy MMORPG character screen background, vertical 3:4, dark painterly digital art, Diablo inventory style.
A dark stone hall with a round carved stone pedestal in the center lit by a warm golden light from above, faint magic circle on the pedestal, dark edges, subtle dust particles.
Empty — no character, no UI, no text. The pedestal is in the lower-middle part of the image.
```
