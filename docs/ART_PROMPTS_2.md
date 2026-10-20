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
Text: "MYSTIC HORIZON" (exactly this spelling), two lines: "MYSTIC" on top, "HORIZON" below.
Centered, isolated on a flat solid magenta #FF00FF background, no other text, no watermark. Wide format 2:1.
```
*(игра называется «Mystic Horizon»; пока нет картинки, в лобби показывается текстовый логотип)*

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

---

## М. Обычные монстры и полубоссы (сейчас их рисует генератор)

Каждый промт самодостаточный — копируйте блок целиком. 4 монстра на лист, ряд — один монстр, **смотрит вправо**, 4 кадра ходьбы + 3 кадра атаки.
Листы М-1…М-3 — на **пурпурном** фоне (там зелёные гоблины, орки, энт и зомби), остальные — на зелёном.

**М-1** — гоблины
```
Pixel art fantasy RPG monster sprite sheet, Lineage 2 / Diablo pixel art style, top-down 3/4 view, same style as the heroes. Regular enemies: medium size, simpler than bosses, strong readable silhouette.
Pure bright magenta background (#FF00FF), no text, no grid lines, no ground shadows.
Strict grid: 4 rows × 7 frames, all frames the same size, generous empty magenta space between frames, monsters never touch each other.
Every monster faces RIGHT. In each row: frames 1–4 = walk cycle, frames 5–7 = attack (wind-up, strike, recover).
Row 1 — Goblin Raider: small green goblin in scrap leather armor with a jagged cleaver and a round wooden shield; attack = cleaver chop.
Row 2 — Goblin Archer: skinny green goblin with a hood, quiver and short bow; attack = drawing and shooting an arrow.
Row 3 — Goblin Shaman: hunched green goblin in a bone mask and feathers, staff with a glowing skull; attack = raising the staff with a purple spark.
Row 4 — Goblin Healer: old green goblin with a herb bag and a mortar on its back, wooden ladle staff; attack = splashing a yellow healing potion.
```

**М-2** — орки, гоблин-миньон, паук
```
Pixel art fantasy RPG monster sprite sheet, Lineage 2 / Diablo pixel art style, top-down 3/4 view, same style as the heroes. Regular enemies: medium size, simpler than bosses, strong readable silhouette.
Pure bright magenta background (#FF00FF), no text, no grid lines, no ground shadows.
Strict grid: 4 rows × 7 frames, all frames the same size, generous empty magenta space between frames, monsters never touch each other.
Every monster faces RIGHT. In each row: frames 1–4 = walk cycle, frames 5–7 = attack (wind-up, strike, recover).
Row 1 — Orc Warrior: muscular green orc in iron shoulder plates with a heavy notched sword; attack = overhead sword slash.
Row 2 — Orc Thrower: green orc with a fur vest and a bundle of throwing axes on the back; attack = throwing an axe.
Row 3 — Goblin (summoned minion): tiny green goblin with a dagger and a pot helmet; attack = quick dagger stab.
Row 4 — Poison Spider: large black spider with toxic green markings and dripping fangs; attack = lunging venom bite.
```

**М-3** — лес и гниль
```
Pixel art fantasy RPG monster sprite sheet, Lineage 2 / Diablo pixel art style, top-down 3/4 view, same style as the heroes. Regular enemies: medium size, simpler than bosses, strong readable silhouette.
Pure bright magenta background (#FF00FF), no text, no grid lines, no ground shadows.
Strict grid: 4 rows × 7 frames, all frames the same size, generous empty magenta space between frames, monsters never touch each other.
Every monster faces RIGHT. In each row: frames 1–4 = walk cycle, frames 5–7 = attack (wind-up, strike, recover).
Row 1 — Ancient Ent: walking tree giant with mossy bark, branch arms, glowing amber eyes; attack = heavy branch swing.
Row 2 — Renegade Druid: hooded druid in leaf-and-bark robes with antler crown and gnarled staff; attack = casting a whirl of thorny leaves.
Row 3 — Zombie Berserker: big rotting green-grey zombie with a rusty axe stuck in its shoulder, torn clothes; attack = wild two-handed axe swing.
Row 4 — Zombie (summoned minion): small shambling green-grey zombie with outstretched arms; attack = clawing grab.
```

**М-4** — скелеты
```
Pixel art fantasy RPG monster sprite sheet, Lineage 2 / Diablo pixel art style, top-down 3/4 view, same style as the heroes. Regular enemies: medium size, simpler than bosses, strong readable silhouette.
Pure bright green background (#00FF00), no text, no grid lines, no ground shadows.
Strict grid: 4 rows × 7 frames, all frames the same size, generous empty green space between frames, monsters never touch each other.
Every monster faces RIGHT. In each row: frames 1–4 = walk cycle, frames 5–7 = attack (wind-up, strike, recover).
Row 1 — Skeleton Swordsman: yellowed skeleton in a dented helmet with a rusty sword and wooden shield; attack = sword slash.
Row 2 — Skeleton Crossbowman: skeleton in tattered leather with a heavy crossbow; attack = aiming and firing a bolt.
Row 3 — Skeleton Banner-bearer: skeleton in rusted mail holding a tall torn black banner with a skull emblem; attack = slamming the banner pole with a blue ghost-fire flash.
Row 4 — Skeleton (summoned minion): small plain skeleton with a bone club; attack = club swing.
```

**М-5** — нежить-колдуны
```
Pixel art fantasy RPG monster sprite sheet, Lineage 2 / Diablo pixel art style, top-down 3/4 view, same style as the heroes. Regular enemies: medium size, simpler than bosses, strong readable silhouette.
Pure bright green background (#00FF00), no text, no grid lines, no ground shadows.
Strict grid: 4 rows × 7 frames, all frames the same size, generous empty green space between frames, monsters never touch each other.
Every monster faces RIGHT. In each row: frames 1–4 = walk cycle, frames 5–7 = attack (wind-up, strike, recover).
Row 1 — Skeleton Lord: tall skeleton in a black-gold cape and spiked crown with a bone scepter, blue ghost fire in its eyes; attack = raising the scepter with blue fire.
Row 2 — Lich: floating skeletal mage in purple-black robes with a glowing phylactery gem; attack = casting a violet death bolt.
Row 3 — Necromancer: pale gaunt man in a black hooded robe with bone ornaments and a skull staff; attack = summoning gesture with purple-blue necrotic energy.
Row 4 — Bone Titan: hulking giant built from many fused bones and skulls, huge bone fists; attack = double-fist ground smash.
```

**М-6** — звери
```
Pixel art fantasy RPG monster sprite sheet, Lineage 2 / Diablo pixel art style, top-down 3/4 view, same style as the heroes. Regular enemies: medium size, simpler than bosses, strong readable silhouette.
Pure bright green background (#00FF00), no text, no grid lines, no ground shadows.
Strict grid: 4 rows × 7 frames, all frames the same size, generous empty green space between frames, monsters never touch each other.
Every monster faces RIGHT. In each row: frames 1–4 = walk cycle, frames 5–7 = attack (wind-up, strike, recover).
Row 1 — Alpha Wolf: large dark grey wolf with scars, a white mane and glowing yellow eyes; attack = leaping bite.
Row 2 — Wolf (summoned minion): small grey wolf; attack = quick bite.
Row 3 — Lycanthrope: werewolf in torn trousers, dark brown fur, long claws, red eyes; attack = double claw rake.
Row 4 — Minotaur: huge bull-headed brown minotaur with a nose ring, iron bracers and a giant double axe; attack = axe cleave.
```

**М-7** — стрелки
```
Pixel art fantasy RPG monster sprite sheet, Lineage 2 / Diablo pixel art style, top-down 3/4 view, same style as the heroes. Regular enemies: medium size, simpler than bosses, strong readable silhouette.
Pure bright green background (#00FF00), no text, no grid lines, no ground shadows.
Strict grid: 4 rows × 7 frames, all frames the same size, generous empty green space between frames, monsters never touch each other.
Every monster faces RIGHT. In each row: frames 1–4 = walk cycle, frames 5–7 = attack (wind-up, strike, recover).
Row 1 — Dark Hunter: hooded ranger in black leather with a red scarf and a long recurve bow; attack = drawing and shooting a dark arrow.
Row 2 — Bandit Crossbowman: scruffy bandit in a brown hat and patched leather with a crossbow; attack = firing a bolt.
Row 3 — Phantom Archer: translucent pale-blue ghost archer with a spectral bow and a flowing hooded cloak; attack = shooting a glowing blue arrow.
Row 4 — Centaur Archer: brown-horse centaur with a bare torso, leather bracers and a tall bow; attack = rearing shot.
```

**М-8** — летающие, пауки, кристаллы
```
Pixel art fantasy RPG monster sprite sheet, Lineage 2 / Diablo pixel art style, top-down 3/4 view, same style as the heroes. Regular enemies: medium size, simpler than bosses, strong readable silhouette.
Pure bright green background (#00FF00), no text, no grid lines, no ground shadows.
Strict grid: 4 rows × 7 frames, all frames the same size, generous empty green space between frames, monsters never touch each other.
Every monster faces RIGHT. In each row: frames 1–4 = walk cycle, frames 5–7 = attack (wind-up, strike, recover).
Row 1 — Harpy: winged woman with grey-brown feathered wings, talons for feet and wild hair, flying low; attack = diving talon swipe.
Row 2 — Spider Matriarch: huge purple-black spider with an egg sac on its back and a crown of horns; attack = rearing up and spitting purple web.
Row 3 — Spiderling (summoned minion): tiny purple-black spider; attack = quick bite.
Row 4 — Crystal Guardian: floating humanoid made of blue-violet crystals with a glowing white core; attack = casting a beam of light from its core.
```

**М-9** — маги
```
Pixel art fantasy RPG monster sprite sheet, Lineage 2 / Diablo pixel art style, top-down 3/4 view, same style as the heroes. Regular enemies: medium size, simpler than bosses, strong readable silhouette.
Pure bright green background (#00FF00), no text, no grid lines, no ground shadows.
Strict grid: 4 rows × 7 frames, all frames the same size, generous empty green space between frames, monsters never touch each other.
Every monster faces RIGHT. In each row: frames 1–4 = walk cycle, frames 5–7 = attack (wind-up, strike, recover).
Row 1 — Dark Mage: robed sorcerer in black and dark-red robes with a crooked staff and a hood hiding the face; attack = casting a dark purple orb.
Row 2 — Elementalist: mage in blue-orange robes with three small orbs (fire, water, lightning) floating around; attack = launching a lightning bolt.
Row 3 — Chaos Mage: mage in jagged purple-black robes with a cracked mask and swirling chaos sigils; attack = casting a pink-purple chaos burst.
Row 4 — Cursed Priest: priest in a torn grey cassock with chains and a burning censer, bandaged eyes; attack = swinging the censer with dark smoke.
```

**М-10** — огонь и лёд
```
Pixel art fantasy RPG monster sprite sheet, Lineage 2 / Diablo pixel art style, top-down 3/4 view, same style as the heroes. Regular enemies: medium size, simpler than bosses, strong readable silhouette.
Pure bright green background (#00FF00), no text, no grid lines, no ground shadows.
Strict grid: 4 rows × 7 frames, all frames the same size, generous empty green space between frames, monsters never touch each other.
Every monster faces RIGHT. In each row: frames 1–4 = walk cycle, frames 5–7 = attack (wind-up, strike, recover).
Row 1 — Fire Cultist: cultist in a red hooded robe with a flaming dagger and burning runes on the sleeves; attack = throwing a fireball.
Row 2 — Pyromancer: fiery mage in orange-black robes, hair made of flames, a burning staff; attack = casting a large fire blast.
Row 3 — Ice Warlock: pale warlock in white-blue furs with an icicle staff and frost breath; attack = casting an ice shard.
Row 4 — Cryomancer: frost mage in crystal-blue robes with a floating ice crown; attack = casting a swirling blizzard orb.
```

**М-11** — големы и стражи
```
Pixel art fantasy RPG monster sprite sheet, Lineage 2 / Diablo pixel art style, top-down 3/4 view, same style as the heroes. Regular enemies: medium size, simpler than bosses, strong readable silhouette.
Pure bright green background (#00FF00), no text, no grid lines, no ground shadows.
Strict grid: 4 rows × 7 frames, all frames the same size, generous empty green space between frames, monsters never touch each other.
Every monster faces RIGHT. In each row: frames 1–4 = walk cycle, frames 5–7 = attack (wind-up, strike, recover).
Row 1 — Stone Golem: chunky grey stone golem with glowing blue cracks; attack = heavy punch.
Row 2 — Stone Guard: humanoid statue knight of grey stone with a tower shield and a stone spear; attack = spear thrust.
Row 3 — Iron Golem: riveted iron automaton with an orange furnace glow in its chest; attack = hammer-arm smash with sparks.
Row 4 — Ice Colossus: giant made of blue ice blocks with frosty mist and icicle shoulders; attack = icy ground pound.
```

**М-12** — демоны
```
Pixel art fantasy RPG monster sprite sheet, Lineage 2 / Diablo pixel art style, top-down 3/4 view, same style as the heroes. Regular enemies: medium size, simpler than bosses, strong readable silhouette.
Pure bright green background (#00FF00), no text, no grid lines, no ground shadows.
Strict grid: 4 rows × 7 frames, all frames the same size, generous empty green space between frames, monsters never touch each other.
Every monster faces RIGHT. In each row: frames 1–4 = walk cycle, frames 5–7 = attack (wind-up, strike, recover).
Row 1 — Demon Butcher: fat red-skinned demon in a bloody leather apron with a giant meat cleaver and hooks; attack = cleaver chop.
Row 2 — Hell Guard: armored demon soldier in black-red spiked plate with a halberd and burning eyes; attack = halberd sweep.
Row 3 — Temptress Demon: slender demoness with purple skin, small horns, bat wings and a whip; attack = whip lash with pink sparks.
Row 4 — Imp (summoned minion): tiny red imp with small wings and a pitchfork; attack = pitchfork poke.
```

**М-13** — тёмные жрецы и рыцари
```
Pixel art fantasy RPG monster sprite sheet, Lineage 2 / Diablo pixel art style, top-down 3/4 view, same style as the heroes. Regular enemies: medium size, simpler than bosses, strong readable silhouette.
Pure bright green background (#00FF00), no text, no grid lines, no ground shadows.
Strict grid: 4 rows × 7 frames, all frames the same size, generous empty green space between frames, monsters never touch each other.
Every monster faces RIGHT. In each row: frames 1–4 = walk cycle, frames 5–7 = attack (wind-up, strike, recover).
Row 1 — Demonologist: robed sorcerer in dark red with a demonic grimoire floating in front of him and horned mask; attack = opening the book with a red summoning circle.
Row 2 — Demon Herald: tall horned demon with a war horn and a red banner; attack = blowing the horn with a red shockwave.
Row 3 — Dark Priest: priest in black-purple vestments with a crooked holy symbol and a dark halo; attack = casting a dark purple light.
Row 4 — Cursed Knight: knight in blackened rusted plate armor with a broken greatsword and purple ghost fire in the visor; attack = greatsword slash.
```

**М-14** — убийцы
```
Pixel art fantasy RPG monster sprite sheet, Lineage 2 / Diablo pixel art style, top-down 3/4 view, same style as the heroes. Regular enemies: medium size, simpler than bosses, strong readable silhouette.
Pure bright green background (#00FF00), no text, no grid lines, no ground shadows.
Strict grid: 4 rows × 7 frames, all frames the same size, generous empty green space between frames, monsters never touch each other.
Every monster faces RIGHT. In each row: frames 1–4 = walk cycle, frames 5–7 = attack (wind-up, strike, recover).
Row 1 — Shadow: living black shadow humanoid with glowing white eyes and wisps of smoke; attack = shadow claw strike.
Row 2 — Night Blade: masked assassin in dark blue leather with twin curved daggers; attack = fast double stab.
Row 3 — Phantom Assassin: translucent pale-violet ghost assassin with a hood and a spectral blade; attack = dashing slash with a ghost trail.
Row 4 — Blood Reaper: gaunt hooded reaper in crimson rags with a blood-red scythe; attack = scythe sweep with blood mist.
```

**М-15** — вампиры и полубоссы (чуть крупнее и богаче деталями)
```
Pixel art fantasy RPG monster sprite sheet, Lineage 2 / Diablo pixel art style, top-down 3/4 view, same style as the heroes. Regular enemies: medium size, simpler than bosses, strong readable silhouette.
Pure bright green background (#00FF00), no text, no grid lines, no ground shadows.
Strict grid: 4 rows × 7 frames, all frames the same size, generous empty green space between frames, monsters never touch each other.
Every monster faces RIGHT. In each row: frames 1–4 = walk cycle, frames 5–7 = attack (wind-up, strike, recover).
Row 1 — Vampire Duelist: elegant pale vampire in a black-red coat with a rapier; attack = rapier lunge.
Row 2 — Vampire Lord (mini-boss, bigger): tall vampire noble in an ornate black-gold armor and a high-collar crimson cape, bat wings; attack = claw slash with red blood energy.
Row 3 — Necro Priest (mini-boss, bigger): skeletal high priest in a bone mitre and black-violet robes with a large necrotic staff; attack = casting a violet soul blast.
Row 4 — Demon Executioner (mini-boss, bigger): huge hooded red demon with a giant executioner axe and chains; attack = overhead axe execution strike.
```

---

## Д. Данжи и арены

Тайлы — квадратные, **бесшовные** (края пола стыкуются). Предметы обстановки — отдельным листом на зелёном фоне.

**Д-1** — тайлы данжей мира I (склепы и руины)
```
Pixel art top-down fantasy RPG dungeon tileset, Lineage 2 / Diablo pixel art style, same pixel style as the monsters, seen from above.
One image, strict 4×4 grid of equal SQUARE tiles touching each other, no gaps, no text, no grid lines, no characters.
Every floor tile must be SEAMLESS and tileable on all four sides.
Theme: old crypt and ruins — grey mossy stone, roots, dirt.
Row 1 — four floor variants: plain grey stone slabs; slabs with moss; cracked slabs; slabs with small bones and dirt.
Row 2 — four wall tiles: wall top seen from above; wall front face with bricks; wall front face with a burning torch; wall front face with roots and ivy.
Row 3 — floor with a drain grate; floor with an old blood stain; floor with a rune circle; stairs going down.
Row 4 — closed iron-bound wooden door; open door; iron bars gate; collapsed rubble blocking the way.
```

**Д-2** — тайлы данжей мира II (бездна)
```
Pixel art top-down fantasy RPG dungeon tileset, Lineage 2 / Diablo pixel art style, same pixel style as the monsters, seen from above.
One image, strict 4×4 grid of equal SQUARE tiles touching each other, no gaps, no text, no grid lines, no characters.
Every floor tile must be SEAMLESS and tileable on all four sides.
Theme: abyss fortress — black obsidian and basalt, glowing purple cracks, lava veins.
Row 1 — four floor variants: plain black basalt slabs; slabs with purple glowing cracks; slabs with a thin lava vein; slabs with ash and bones.
Row 2 — four wall tiles: wall top seen from above; obsidian wall front face; wall front face with a purple flame brazier; wall front face with chains and spikes.
Row 3 — floor with a lava grate; floor with a demonic sigil glowing red; floor with purple crystals; stairs going down into darkness.
Row 4 — closed spiked iron door; open door; demonic bone gate; collapsed obsidian rubble.
```

**Д-3** — тайлы данжей мира III (небесная цитадель)
```
Pixel art top-down fantasy RPG dungeon tileset, Lineage 2 / Diablo pixel art style, same pixel style as the monsters, seen from above.
One image, strict 4×4 grid of equal SQUARE tiles touching each other, no gaps, no text, no grid lines, no characters.
Every floor tile must be SEAMLESS and tileable on all four sides.
Theme: celestial citadel — white marble with gold inlay, blue crystals, clouds.
Row 1 — four floor variants: plain white marble tiles; marble with gold lines; cracked marble; marble with small blue crystal shards.
Row 2 — four wall tiles: wall top seen from above; white marble wall front face with gold trim; wall front face with a blue crystal lamp; wall front face with a broken stained-glass window.
Row 3 — floor with a gold star mosaic; floor with a glowing blue rune; floor with a hole showing clouds below; stairs going up.
Row 4 — closed gold-and-white gate; open gate; crystal barrier wall; collapsed marble pillar rubble.
```

**Д-4** — обстановка данжей (зелёный фон)
```
Pixel art fantasy RPG dungeon props sprite sheet, Lineage 2 / Diablo pixel art style, top-down 3/4 view, same pixel style as the monsters.
Pure bright green background (#00FF00), no text, no grid lines, no ground shadows.
Strict grid: 4 rows × 4 objects, all cells the same size, generous empty green space between objects, objects never touch.
Row 1: closed wooden treasure chest; opened chest with gold inside; wooden barrel; stack of wooden crates.
Row 2: pile of bones and skulls; tall candle on a skull; stone brazier with fire; floor spike trap (spikes up).
Row 3: broken stone pillar; ancient knight statue; hanging iron cage; big spider web.
Row 4: dungeon exit altar with a glowing portal; purple demonic altar; blue crystal cluster; golden sarcophagus.
```

**Д-5** — арена мирового босса, мир I
```
Fantasy MMORPG world boss arena floor, painterly digital art in Diablo / Lineage 2 style, seen straight from above (top-down), square 1:1.
A large round arena of ancient grey stone in a forest clearing: carved rune circle in the center, cracked slabs, moss, broken pillars around the edge, roots and old bones. Dark forest edges fading to black in the corners.
Empty — no characters, no monsters, no text, no UI.
```

**Д-6** — арена мирового босса, мир II
```
Fantasy MMORPG world boss arena floor, painterly digital art in Diablo / Lineage 2 style, seen straight from above (top-down), square 1:1.
A large round arena of black obsidian floating over a lava abyss: glowing purple demonic sigil in the center, cracks with lava light, chains and spiked pillars around the edge, lava glow in the corners.
Empty — no characters, no monsters, no text, no UI.
```

**Д-7** — арена мирового босса, мир III
```
Fantasy MMORPG world boss arena floor, painterly digital art in Diablo / Lineage 2 style, seen straight from above (top-down), square 1:1.
A large round arena of white marble with gold inlay floating among clouds: a glowing golden star mosaic in the center, blue crystal pylons and broken white columns around the edge, clouds and sky in the corners.
Empty — no characters, no monsters, no text, no UI.
```

---

## И (продолжение). Интерфейс, магазин, продвижение

**И-10** — иконки состояний в бою (пурпурный фон)
```
Fantasy MMORPG status effect icons (buffs and debuffs), hand-painted in the style of Diablo and Lineage 2 skill icons, round medallion shape with a thin ornate rim, one bold readable symbol per icon, readable at 32 px, high detail.
Flat solid pure magenta #FF00FF background everywhere, no text, no watermark.
One image with exactly 16 icons in a 4×4 grid, equal cells, generous empty space between them, icons never touch.
Debuffs have a dark red rim, buffs have a gold rim.
Row 1 (debuffs): 1) Stun — golden stars circling over a dazed helmet. 2) Root — green thorny vines wrapped around a boot. 3) Slow — a cracked blue hourglass with a snail shell. 4) Freeze — a block of blue ice with frost crystals.
Row 2 (debuffs): 5) Fear — a pale screaming ghost face. 6) Taunt — a furious red eye inside a target mark. 7) Weakness — a broken sword. 8) Curse — a purple skull in dark smoke.
Row 3: 9) Poison (debuff) — a green venom drop with a small skull. 10) Burn (debuff) — orange-red flames. 11) Bleed (debuff) — red blood drops over a claw slash. 12) Shield (buff) — a glowing blue magic barrier dome.
Row 4 (buffs): 13) Haste — a winged boot with wind streaks. 14) Rage — a roaring red beast face in flames. 15) Regeneration — a green leaf with healing sparkles. 16) Invulnerability — a radiant golden shield with a halo.
```

**И-11** — магазин: кристаллы, золото, ларцы, подписка (пурпурный фон)
```
Fantasy MMORPG shop item icons, hand-painted digital art in the style of Diablo and Lineage 2 item icons, ornate details, magical glow, 3/4 view, strong readable silhouette at 64 px, soft rim light, painterly texture, high detail.
Each object is isolated and centered in its own cell, fills about 80% of the cell, does not touch neighbours.
Flat solid pure magenta #FF00FF background everywhere, no shadows on the background, no text, no frame, no watermark.
One image with exactly 12 icons in a 3×4 grid (3 rows, 4 columns), equal cells, generous empty space between them:
Row 1: 1) small handful of blue crystals; 2) leather pouch overflowing with blue crystals; 3) wooden chest full of blue crystals; 4) huge golden treasure chest bursting with glowing blue crystals.
Row 2: 5) small stack of gold coins; 6) leather bag of gold coins; 7) iron-bound chest full of gold coins; 8) ornate purple-and-gold set chest with a glowing class emblem on the lid.
Row 3: 9) black-and-gold grandmaster chest with glowing magic scrolls on top; 10) five ornate set chests stacked in a pyramid; 11) premium subscription — golden crown on a red velvet cushion; 12) battle pass — rolled golden scroll with a red ribbon and a sword through it.
```

**И-12** — добыча на земле (пурпурный фон)
```
Pixel art fantasy RPG loot sprites, Lineage 2 / Diablo pixel art style, top-down 3/4 view, same pixel style as the monsters, small objects lying on the ground.
Pure bright magenta background (#FF00FF), no text, no grid lines, no ground shadows.
Strict grid: 2 rows × 4 objects, all cells the same size, generous empty magenta space between objects.
Row 1: a few scattered gold coins; a leather bag of gold; a rolled magic scroll with a ribbon; a red health potion bottle.
Row 2: small iron chest (grey); silver chest with blue glow; gold chest with purple glow; ornate golden chest with orange radiant glow and light rays.
```

**И-13** — фон окна арены PvP (без вырезания)
```
Fantasy MMORPG arena screen background, vertical 3:4, dark painterly digital art, Diablo / Lineage 2 style.
An ancient stone coliseum at dusk seen from the sand floor: tiers of seats in shadow, banners, torches, crossed swords emblem over the gate, dust in golden light. Center and lower part calmer for UI.
Empty — no characters, no UI, no text.
```

**И-14** — фон окна выживания (без вырезания)
```
Fantasy MMORPG survival mode screen background, vertical 3:4, dark painterly digital art, Diablo / Lineage 2 style.
A ruined fortress courtyard at night under a red moon, broken walls, burning barricades, shadows of a monster horde on the horizon, embers in the air. Center and lower part calmer for UI.
Empty — no characters in the foreground, no UI, no text.
```

**И-15** — фон кузницы и аукциона (без вырезания, 2 картинки отдельно)
```
Fantasy MMORPG blacksmith screen background, vertical 3:4, warm painterly digital art, Diablo / Lineage 2 style.
A dwarven forge interior: glowing furnace, anvil with a hammer, weapons on the walls, sparks and warm orange light, dark edges. Center and lower part calmer for UI.
Empty — no characters, no UI, no text.
```
```
Fantasy MMORPG auction house screen background, vertical 3:4, painterly digital art, Diablo / Lineage 2 style.
A grand merchant hall: wooden counters, chests of gold, scales, hanging lanterns, shelves with goods and scrolls, warm candle light, dark edges. Center and lower part calmer for UI.
Empty — no characters, no UI, no text.
```

**И-16** — рамки аватаров (пурпурный фон)
```
Fantasy MMORPG round player avatar frames, hand-painted ornate metal, Diablo / Lineage 2 style.
One image with exactly 6 ROUND frames in a row, equal size, generous empty space between them, flat solid magenta #FF00FF background.
Each frame is a ring with ornaments on the outside only; the CENTER is EMPTY and magenta (hollow), no portraits, no text.
1) Bronze — simple bronze ring. 2) Silver — silver ring with small blue gems. 3) Gold — gold ring with laurel leaves. 4) Platinum — white-gold ring with wings on the sides. 5) Diamond — crystal-blue ring with large diamonds and frost. 6) Legend — gold and crimson ring with flames, a crown on top and dragon wings on the sides.
```

**И-17** — аватар и баннер бота в Telegram (без вырезания, 2 картинки)
```
Fantasy MMORPG game app icon, square 1:1, painterly digital art in Diablo / Lineage 2 style.
A heraldic emblem: a glowing blue crystal and a sword crossed over a dark iron shield with gold trim and small dragon wings, dramatic light, dark background with a soft blue glow. Bold silhouette readable as a small round avatar. No text.
```
```
Fantasy MMORPG promo banner, wide 16:9, painterly digital art in Diablo / Lineage 2 style.
A party of four heroes (armored knight, elf archer, mage with a staff, dwarf with a hammer) standing heroically in front of a glowing portal, a dragon in the stormy sky behind them, golden light. Leave the left third calmer and darker for a title. No text, no logo.
```

**И-18** — карточка приглашения друга (без вырезания)
```
Fantasy MMORPG invite card illustration, wide 1.9:1 (1200×630), painterly digital art in Diablo / Lineage 2 style.
Two heroes from behind (knight and mage) looking at a huge glowing portal with three worlds visible inside (green valley, purple abyss, golden sky citadel), the knight raising a hand as if calling a friend. Leave the bottom quarter calmer for text. No text, no logo.
```

**И-19** — стикеры для чата (пурпурный фон)
```
Fantasy MMORPG chat stickers, cute chibi characters, hand-painted, bold outlines, expressive faces, Diablo / Lineage 2 fantasy theme.
Flat solid pure magenta #FF00FF background, no text, no watermark.
One image with exactly 8 stickers in a 2×4 grid, equal cells, generous empty space between them, each sticker has a thin white outline:
1) knight giving a thumbs up; 2) mage laughing with tears; 3) elf archer crying a river; 4) orc furious with steam from the ears; 5) greedy goblin hugging a bag of gold; 6) skeleton waving for help; 7) dwarf sleeping on his hammer with Zzz bubbles; 8) baby dragon making a heart with its wings.
```

---

**Д-8** — ворота в комнаты боссов (зелёный фон)
```
Pixel art fantasy RPG dungeon boss gates sprite sheet, Lineage 2 / Diablo pixel art style, top-down 3/4 view, same pixel style as the monsters and dungeon tiles.
Pure bright green background (#00FF00), no text, no grid lines, no ground shadows.
Strict grid: 3 rows × 4 objects, all cells the same size, generous empty green space between objects, objects never touch.
Each gate is a square-ish stone archway seen from the front, standing on the floor, wide enough for a corridor 3 tiles wide.
Columns in every row: 1) closed gate; 2) gate half open; 3) gate fully open (empty passage); 4) magic seal barrier glowing over the closed gate.
Row 1 — World I crypt: grey mossy stone arch with skulls, heavy iron portcullis bars, rusty chains, torches on both sides; seal = green ghost-fire rune wall.
Row 2 — World II abyss: black obsidian arch with horns and spikes, demonic bone-and-iron bars, purple fire braziers; seal = purple-red demonic sigil wall.
Row 3 — World III celestial: white marble arch with gold trim and blue crystals, golden ornate bars; seal = shimmering blue crystal light wall.
```

---

**И-20** — иконки заданий (пурпурный фон)
```
Fantasy MMORPG quest icons, hand-painted in the style of Diablo and Lineage 2 item icons, ornate details, magical glow, 3/4 view, one bold readable object per icon, readable at 48 px, soft rim light, painterly texture, high detail.
Each object is isolated and centered in its own cell, fills about 80% of the cell, does not touch neighbours.
Flat solid pure magenta #FF00FF background everywhere, no frame, no circle, no text, no watermark.
One image with exactly 16 icons in a 4×4 grid, equal cells, generous empty space between them:
Row 1: 1) crossed hunting dagger and sword over green grass and a leaf (hunt in the green valley); 2) a burning sword stuck in red-hot ashes with embers (hunt in the ash lands); 3) a winged silver spear over a small white cloud (hunt in the sky citadel); 4) a golden star medal with a red ribbon and a small crown (hunt the strong ones).
Row 2: 5) an old rolled dungeon map with a red X and a tiny torch (conquer the labyrinth); 6) a glowing purple summoning crystal on a small rune altar (summon of the day); 7) two crossed gladiator swords over a round arena shield (arena warm-up); 8) a battle-worn great axe and sword crossed over a pile of skulls (crusade).
Row 3: 9) a heavy golden crown with a crack and a drop of blood (boss slayer); 10) a dungeon gate tower with an open iron door and a key (dungeon expert); 11) a horned skull with blue flames in the eyes on broken stones (survivor); 12) a dragon head trophy on a wooden shield plaque (world boss victor).
Row 4: 13) a golden trophy cup with gems and laurels (hero of the month); 14) an ornate ancient key with a glowing rune (master of labyrinths); 15) a stack of three hero portrait cards fanned out with a golden frame (collector); 16) a single shining five-pointed golden star with sparkles (event points).
```

---

## Б-HD. Боссы в высоком качестве (один босс на картинку)

Один босс на лист: кадры крупнее в 2–3 раза, детали не теряются при вырезке. Вместо `[ОПИСАНИЕ]` вставьте строку босса из Б-1…Б-7 (текст после «Row N —»). Подписывайте «Б-HD: имя босса».
```
High quality pixel art fantasy RPG boss sprite sheet, Lineage 2 / Diablo style, top-down 3/4 view, large detailed sprite with clean crisp pixels, strong silhouette, rich shading and rim light, no blur, no anti-aliasing smear.
ONE boss only: [ОПИСАНИЕ]
Pure bright green background (#00FF00) everywhere, no text, no grid lines, no ground shadows, no effects touching the frame edges.
Strict grid: 2 rows × 4 frames, all frames the same size, the boss fills about 75% of each frame height, generous empty green space between frames, nothing crosses into a neighbouring frame.
The boss faces RIGHT in every frame. Row 1: 4-frame walk cycle. Row 2: attack — 1) wind-up, 2) strike, 3) strike impact with effect kept inside the frame, 4) recover.
Same character, same size and same colors in all 8 frames.
```

---

## БХ. Боссы в высоком качестве — готовые промты (один босс на картинку)

Копируйте блок целиком, подписывайте номер (БХ-1, БХ-2…). Заменит прежний рисунок босса.

**БХ-1** — Тролль-шаман
```
High quality pixel art fantasy RPG boss sprite sheet, Lineage 2 / Diablo style, top-down 3/4 view, large detailed sprite with clean crisp pixels, strong silhouette, rich shading and rim light, no blur.
ONE boss only: Troll Shaman: hunched green-grey troll with tusks, bone staff with skulls, feathers and voodoo totems; attack = staff slam with green magic.
Pure bright magenta background (#FF00FF) everywhere, no text, no grid lines, no ground shadows.
Strict grid: 2 rows × 4 frames, all frames the same size, the boss fills about 75% of each frame height, generous empty space between frames, nothing crosses into a neighbouring frame.
The boss faces RIGHT in every frame. Row 1: 4-frame walk cycle. Row 2: attack — wind-up, strike, impact (effect kept inside the frame), recover.
Same character, same size and same colors in all 8 frames.
```

**БХ-2** — Грифон
```
High quality pixel art fantasy RPG boss sprite sheet, Lineage 2 / Diablo style, top-down 3/4 view, large detailed sprite with clean crisp pixels, strong silhouette, rich shading and rim light, no blur.
ONE boss only: Gryphon: eagle-headed lion with golden-brown feathers and huge wings; attack = wing-spread claw strike.
Pure bright green background (#00FF00) everywhere, no text, no grid lines, no ground shadows.
Strict grid: 2 rows × 4 frames, all frames the same size, the boss fills about 75% of each frame height, generous empty space between frames, nothing crosses into a neighbouring frame.
The boss faces RIGHT in every frame. Row 1: 4-frame walk cycle. Row 2: attack — wind-up, strike, impact (effect kept inside the frame), recover.
Same character, same size and same colors in all 8 frames.
```

**БХ-3** — Король скелетов
```
High quality pixel art fantasy RPG boss sprite sheet, Lineage 2 / Diablo style, top-down 3/4 view, large detailed sprite with clean crisp pixels, strong silhouette, rich shading and rim light, no blur.
ONE boss only: Skeleton King: tall skeleton in rusted crown and royal tattered cape, giant bone sword, blue ghost fire; attack = overhead sword cleave.
Pure bright green background (#00FF00) everywhere, no text, no grid lines, no ground shadows.
Strict grid: 2 rows × 4 frames, all frames the same size, the boss fills about 75% of each frame height, generous empty space between frames, nothing crosses into a neighbouring frame.
The boss faces RIGHT in every frame. Row 1: 4-frame walk cycle. Row 2: attack — wind-up, strike, impact (effect kept inside the frame), recover.
Same character, same size and same colors in all 8 frames.
```

**БХ-4** — Вождь орков
```
High quality pixel art fantasy RPG boss sprite sheet, Lineage 2 / Diablo style, top-down 3/4 view, large detailed sprite with clean crisp pixels, strong silhouette, rich shading and rim light, no blur.
ONE boss only: Orc Chief: massive green orc in spiked iron armor with a huge double axe and war paint; attack = axe swing.
Pure bright magenta background (#FF00FF) everywhere, no text, no grid lines, no ground shadows.
Strict grid: 2 rows × 4 frames, all frames the same size, the boss fills about 75% of each frame height, generous empty space between frames, nothing crosses into a neighbouring frame.
The boss faces RIGHT in every frame. Row 1: 4-frame walk cycle. Row 2: attack — wind-up, strike, impact (effect kept inside the frame), recover.
Same character, same size and same colors in all 8 frames.
```

**БХ-5** — Каменный титан
```
High quality pixel art fantasy RPG boss sprite sheet, Lineage 2 / Diablo style, top-down 3/4 view, large detailed sprite with clean crisp pixels, strong silhouette, rich shading and rim light, no blur.
ONE boss only: Stone Titan: giant golem of mossy grey boulders with glowing amber runes; attack = ground-pound with both fists.
Pure bright magenta background (#FF00FF) everywhere, no text, no grid lines, no ground shadows.
Strict grid: 2 rows × 4 frames, all frames the same size, the boss fills about 75% of each frame height, generous empty space between frames, nothing crosses into a neighbouring frame.
The boss faces RIGHT in every frame. Row 1: 4-frame walk cycle. Row 2: attack — wind-up, strike, impact (effect kept inside the frame), recover.
Same character, same size and same colors in all 8 frames.
```

**БХ-6** — Дракончик
```
High quality pixel art fantasy RPG boss sprite sheet, Lineage 2 / Diablo style, top-down 3/4 view, large detailed sprite with clean crisp pixels, strong silhouette, rich shading and rim light, no blur.
ONE boss only: Dragon Whelp: young red-orange dragon, small wings, fiery belly; attack = fire breath burst.
Pure bright green background (#00FF00) everywhere, no text, no grid lines, no ground shadows.
Strict grid: 2 rows × 4 frames, all frames the same size, the boss fills about 75% of each frame height, generous empty space between frames, nothing crosses into a neighbouring frame.
The boss faces RIGHT in every frame. Row 1: 4-frame walk cycle. Row 2: attack — wind-up, strike, impact (effect kept inside the frame), recover.
Same character, same size and same colors in all 8 frames.
```

**БХ-7** — Кракен
```
High quality pixel art fantasy RPG boss sprite sheet, Lineage 2 / Diablo style, top-down 3/4 view, large detailed sprite with clean crisp pixels, strong silhouette, rich shading and rim light, no blur.
ONE boss only: Kraken: dark purple sea monster with many tentacles rising from a small pool of black water; attack = tentacle slam.
Pure bright green background (#00FF00) everywhere, no text, no grid lines, no ground shadows.
Strict grid: 2 rows × 4 frames, all frames the same size, the boss fills about 75% of each frame height, generous empty space between frames, nothing crosses into a neighbouring frame.
The boss faces RIGHT in every frame. Row 1: 4-frame walk cycle. Row 2: attack — wind-up, strike, impact (effect kept inside the frame), recover.
Same character, same size and same colors in all 8 frames.
```

**БХ-8** — Цербер
```
High quality pixel art fantasy RPG boss sprite sheet, Lineage 2 / Diablo style, top-down 3/4 view, large detailed sprite with clean crisp pixels, strong silhouette, rich shading and rim light, no blur.
ONE boss only: Cerberus: three-headed black hellhound with burning red eyes and fiery manes; attack = triple bite with flames.
Pure bright green background (#00FF00) everywhere, no text, no grid lines, no ground shadows.
Strict grid: 2 rows × 4 frames, all frames the same size, the boss fills about 75% of each frame height, generous empty space between frames, nothing crosses into a neighbouring frame.
The boss faces RIGHT in every frame. Row 1: 4-frame walk cycle. Row 2: attack — wind-up, strike, impact (effect kept inside the frame), recover.
Same character, same size and same colors in all 8 frames.
```

**БХ-9** — Король-лич
```
High quality pixel art fantasy RPG boss sprite sheet, Lineage 2 / Diablo style, top-down 3/4 view, large detailed sprite with clean crisp pixels, strong silhouette, rich shading and rim light, no blur.
ONE boss only: Lich King: skeletal sorcerer in black-purple robes and ice crown, floating, with a frost staff; attack = casting a blue-violet frost spell.
Pure bright green background (#00FF00) everywhere, no text, no grid lines, no ground shadows.
Strict grid: 2 rows × 4 frames, all frames the same size, the boss fills about 75% of each frame height, generous empty space between frames, nothing crosses into a neighbouring frame.
The boss faces RIGHT in every frame. Row 1: 4-frame walk cycle. Row 2: attack — wind-up, strike, impact (effect kept inside the frame), recover.
Same character, same size and same colors in all 8 frames.
```

**БХ-10** — Повелитель демонов
```
High quality pixel art fantasy RPG boss sprite sheet, Lineage 2 / Diablo style, top-down 3/4 view, large detailed sprite with clean crisp pixels, strong silhouette, rich shading and rim light, no blur.
ONE boss only: Demon Lord: huge red-black demon with horns, bat wings and a flaming whip; attack = whip lash with fire.
Pure bright green background (#00FF00) everywhere, no text, no grid lines, no ground shadows.
Strict grid: 2 rows × 4 frames, all frames the same size, the boss fills about 75% of each frame height, generous empty space between frames, nothing crosses into a neighbouring frame.
The boss faces RIGHT in every frame. Row 1: 4-frame walk cycle. Row 2: attack — wind-up, strike, impact (effect kept inside the frame), recover.
Same character, same size and same colors in all 8 frames.
```

**БХ-11** — Титан Бездны
```
High quality pixel art fantasy RPG boss sprite sheet, Lineage 2 / Diablo style, top-down 3/4 view, large detailed sprite with clean crisp pixels, strong silhouette, rich shading and rim light, no blur.
ONE boss only: Abyss Titan: colossal giant of black obsidian with purple cracks of void energy; attack = heavy punch with void shockwave.
Pure bright green background (#00FF00) everywhere, no text, no grid lines, no ground shadows.
Strict grid: 2 rows × 4 frames, all frames the same size, the boss fills about 75% of each frame height, generous empty space between frames, nothing crosses into a neighbouring frame.
The boss faces RIGHT in every frame. Row 1: 4-frame walk cycle. Row 2: attack — wind-up, strike, impact (effect kept inside the frame), recover.
Same character, same size and same colors in all 8 frames.
```

**БХ-12** — Древний дракон
```
High quality pixel art fantasy RPG boss sprite sheet, Lineage 2 / Diablo style, top-down 3/4 view, large detailed sprite with clean crisp pixels, strong silhouette, rich shading and rim light, no blur.
ONE boss only: Ancient Dragon: enormous dark green-bronze dragon with horns and torn wings; attack = biting lunge with smoke.
Pure bright magenta background (#FF00FF) everywhere, no text, no grid lines, no ground shadows.
Strict grid: 2 rows × 4 frames, all frames the same size, the boss fills about 75% of each frame height, generous empty space between frames, nothing crosses into a neighbouring frame.
The boss faces RIGHT in every frame. Row 1: 4-frame walk cycle. Row 2: attack — wind-up, strike, impact (effect kept inside the frame), recover.
Same character, same size and same colors in all 8 frames.
```

**БХ-13** — Феникс
```
High quality pixel art fantasy RPG boss sprite sheet, Lineage 2 / Diablo style, top-down 3/4 view, large detailed sprite with clean crisp pixels, strong silhouette, rich shading and rim light, no blur.
ONE boss only: Phoenix: blazing golden-orange firebird with long flaming tail feathers; attack = fiery wing sweep.
Pure bright green background (#00FF00) everywhere, no text, no grid lines, no ground shadows.
Strict grid: 2 rows × 4 frames, all frames the same size, the boss fills about 75% of each frame height, generous empty space between frames, nothing crosses into a neighbouring frame.
The boss faces RIGHT in every frame. Row 1: 4-frame walk cycle. Row 2: attack — wind-up, strike, impact (effect kept inside the frame), recover.
Same character, same size and same colors in all 8 frames.
```

**БХ-14** — Падший ангел
```
High quality pixel art fantasy RPG boss sprite sheet, Lineage 2 / Diablo style, top-down 3/4 view, large detailed sprite with clean crisp pixels, strong silhouette, rich shading and rim light, no blur.
ONE boss only: Fallen Angel: dark angel in cracked white-gold armor with black feathered wings and a broken halo, holding a spear; attack = spear thrust with dark light.
Pure bright green background (#00FF00) everywhere, no text, no grid lines, no ground shadows.
Strict grid: 2 rows × 4 frames, all frames the same size, the boss fills about 75% of each frame height, generous empty space between frames, nothing crosses into a neighbouring frame.
The boss faces RIGHT in every frame. Row 1: 4-frame walk cycle. Row 2: attack — wind-up, strike, impact (effect kept inside the frame), recover.
Same character, same size and same colors in all 8 frames.
```

**БХ-15** — Горгона
```
High quality pixel art fantasy RPG boss sprite sheet, Lineage 2 / Diablo style, top-down 3/4 view, large detailed sprite with clean crisp pixels, strong silhouette, rich shading and rim light, no blur.
ONE boss only: Gorgon: snake-haired queen with a serpent tail, bronze armor and a bow; attack = petrifying green gaze burst.
Pure bright magenta background (#FF00FF) everywhere, no text, no grid lines, no ground shadows.
Strict grid: 2 rows × 4 frames, all frames the same size, the boss fills about 75% of each frame height, generous empty space between frames, nothing crosses into a neighbouring frame.
The boss faces RIGHT in every frame. Row 1: 4-frame walk cycle. Row 2: attack — wind-up, strike, impact (effect kept inside the frame), recover.
Same character, same size and same colors in all 8 frames.
```

**БХ-16** — Повелитель хаоса
```
High quality pixel art fantasy RPG boss sprite sheet, Lineage 2 / Diablo style, top-down 3/4 view, large detailed sprite with clean crisp pixels, strong silhouette, rich shading and rim light, no blur.
ONE boss only: Lord of Chaos: armored warlord in jagged purple-black armor, cloak of storm clouds, two chaos blades; attack = double cross slash with lightning.
Pure bright green background (#00FF00) everywhere, no text, no grid lines, no ground shadows.
Strict grid: 2 rows × 4 frames, all frames the same size, the boss fills about 75% of each frame height, generous empty space between frames, nothing crosses into a neighbouring frame.
The boss faces RIGHT in every frame. Row 1: 4-frame walk cycle. Row 2: attack — wind-up, strike, impact (effect kept inside the frame), recover.
Same character, same size and same colors in all 8 frames.
```

**БХ-17** — Легион
```
High quality pixel art fantasy RPG boss sprite sheet, Lineage 2 / Diablo style, top-down 3/4 view, large detailed sprite with clean crisp pixels, strong silhouette, rich shading and rim light, no blur.
ONE boss only: The Legion: a towering mass of armored skeletal soldiers fused into one giant with many shields and spears; attack = spear wall thrust.
Pure bright green background (#00FF00) everywhere, no text, no grid lines, no ground shadows.
Strict grid: 2 rows × 4 frames, all frames the same size, the boss fills about 75% of each frame height, generous empty space between frames, nothing crosses into a neighbouring frame.
The boss faces RIGHT in every frame. Row 1: 4-frame walk cycle. Row 2: attack — wind-up, strike, impact (effect kept inside the frame), recover.
Same character, same size and same colors in all 8 frames.
```

**БХ-18** — Пожиратель
```
High quality pixel art fantasy RPG boss sprite sheet, Lineage 2 / Diablo style, top-down 3/4 view, large detailed sprite with clean crisp pixels, strong silhouette, rich shading and rim light, no blur.
ONE boss only: The Devourer: bloated abyss beast with a huge fanged maw and many eyes, purple-black flesh; attack = gaping bite.
Pure bright green background (#00FF00) everywhere, no text, no grid lines, no ground shadows.
Strict grid: 2 rows × 4 frames, all frames the same size, the boss fills about 75% of each frame height, generous empty space between frames, nothing crosses into a neighbouring frame.
The boss faces RIGHT in every frame. Row 1: 4-frame walk cycle. Row 2: attack — wind-up, strike, impact (effect kept inside the frame), recover.
Same character, same size and same colors in all 8 frames.
```

**БХ-19** — Аватар Бездны
```
High quality pixel art fantasy RPG boss sprite sheet, Lineage 2 / Diablo style, top-down 3/4 view, large detailed sprite with clean crisp pixels, strong silhouette, rich shading and rim light, no blur.
ONE boss only: Avatar of the Abyss: giant shadow humanoid made of void and purple fire, with a crown of black spikes; attack = void palm strike.
Pure bright green background (#00FF00) everywhere, no text, no grid lines, no ground shadows.
Strict grid: 2 rows × 4 frames, all frames the same size, the boss fills about 75% of each frame height, generous empty space between frames, nothing crosses into a neighbouring frame.
The boss faces RIGHT in every frame. Row 1: 4-frame walk cycle. Row 2: attack — wind-up, strike, impact (effect kept inside the frame), recover.
Same character, same size and same colors in all 8 frames.
```

**БХ-20** — Вечный дракон
```
High quality pixel art fantasy RPG boss sprite sheet, Lineage 2 / Diablo style, top-down 3/4 view, large detailed sprite with clean crisp pixels, strong silhouette, rich shading and rim light, no blur.
ONE boss only: Eternal Dragon: majestic white-gold celestial dragon with glowing blue runes and star-filled wings; attack = holy breath beam.
Pure bright green background (#00FF00) everywhere, no text, no grid lines, no ground shadows.
Strict grid: 2 rows × 4 frames, all frames the same size, the boss fills about 75% of each frame height, generous empty space between frames, nothing crosses into a neighbouring frame.
The boss faces RIGHT in every frame. Row 1: 4-frame walk cycle. Row 2: attack — wind-up, strike, impact (effect kept inside the frame), recover.
Same character, same size and same colors in all 8 frames.
```

**БХ-21** — Титан хаоса
```
High quality pixel art fantasy RPG boss sprite sheet, Lineage 2 / Diablo style, top-down 3/4 view, large detailed sprite with clean crisp pixels, strong silhouette, rich shading and rim light, no blur.
ONE boss only: Chaos Titan: colossus of floating rock and storm with lightning veins and a ring of debris; attack = lightning slam.
Pure bright green background (#00FF00) everywhere, no text, no grid lines, no ground shadows.
Strict grid: 2 rows × 4 frames, all frames the same size, the boss fills about 75% of each frame height, generous empty space between frames, nothing crosses into a neighbouring frame.
The boss faces RIGHT in every frame. Row 1: 4-frame walk cycle. Row 2: attack — wind-up, strike, impact (effect kept inside the frame), recover.
Same character, same size and same colors in all 8 frames.
```
