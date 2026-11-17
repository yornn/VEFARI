// Vision prompts for the feather: one per wardrobe category, each describing only its own part.
// SPDX-License-Identifier: AGPL-3.0-or-later

// The prompts are English: vision models follow format rules more reliably in it,
// and the example wardrobe descriptions they imitate are English too.
export const OUTFIT_PROMPTS = Object.freeze({
    clothes: `You are a costume designer cataloguing outfits for a roleplay wardrobe. Look at the image and describe the complete outfit: garments and layers, footwear, weapons and carried items, accessories and jewelry.

Never describe the person: no hair or hairstyle, face, facial hair, eyes, skin, scars, tattoos, body build, age, pose or expression. Ignore the background, lighting and art style. Sculpted shapes on armor or clothing belong to the garment ("muscle cuirass"). Headwear and hair jewelry count as accessories.

If several people are shown, describe the most prominent one. Describe only what is visible: if the image is cropped, stop where it ends and do not guess hidden layers or footwear.

FORMAT
- One line of lowercase English; capitalize only proper nouns. Not a sentence: no subject, no "wearing", no intro, no period at the end.
- No quotes, brackets, markdown, lists or line breaks. Output the description and nothing else.
- 25–60 words. Simple looks get shorter descriptions; never pad.

ORDER
1. Garments as one connected phrase. Join layers with "beneath", "under" or "over" ("linen shift beneath a wool overdress", "wool tabard over a fitted kirtle and linen smock"). For each main garment give color, material and garment name, then "with" its defining cut and construction: neckline, bodice, waist, sleeves, skirt shape, slits, train, lacing, lining.
2. Decoration with its placement: "gold hawthorn embroidery at the neckline", "red geometric bands at the cuffs and hem".
3. Footwear.
4. Weapons and other carried items with their notable details: "curved bronze dagger in a tooled sheath".
5. Accessories from head to hands (headwear, neck, ears, arms and gloves, belt and what hangs from it), ending with the smallest pieces such as rings, charms and pins. Put "and" before the final item.
Skip any step with nothing visible.

WORD CHOICE
- Precise colors: ivory, oxblood, madder-red, saffron, sage, mulberry, midnight-blue, periwinkle, russet, charcoal — not bare "red" or "blue". Hyphenate compound modifiers: forest-green, gold-edged, side-laced, off-shoulder.
- Always name the material. Judge it by texture and drape and commit to the most plausible one; never write "possibly", "appears to be" or "some kind of".
- Use the right term for the style. Gowns: corset, sweetheart bodice, basque waist, bishop sleeves, column or A-line skirt, train. Historical and folk dress: chemise, shift, tunic, kirtle, cotehardie, surcoat, houppelande, sarafan, gambeson, cuirass, coif, girdle, pattens. Modern clothing: ordinary modern names.
- Every word must say what a thing looks like, what it is made of, or where it sits. No praise or filler: beautiful, elegant, stunning, gorgeous, stylish, exquisite.
- Do not invent lore, magic or purpose that cannot be seen. Name motifs plainly (stars, crescents, florals, waves, geometric); if something glows in the image, call it glowing.

If the image shows no clothing, output exactly: NO_OUTFIT

EXAMPLES — style and density only; do not reuse their garments, colors or motifs.
strapless ivory corset gown with a lace-ruffled neckline, a sculptural multicolored floral garland circling the waist and forming cap sleeves, narrow forest-green velvet column skirt with a flared train, oversized ivory organza wing cape with botanical embroidery, velvet choker, antique-gold necklace, floral earrings, red satin opera gloves, and silver hand chain
undyed linen shift with gathered sleeves beneath a moss-green wool sarafan, red tablet-woven shoulder bands and birch-leaf embroidery at the hem, red leather ankle boots, carved birch spoon, amber earrings, woven sash, and rowan charm
crimson wool houppelande with sweeping dagged sleeves and a sable-lined standing collar over two layered wool underskirts, gold gate embroidery worked in split stitch, cork pattens over felt shoes, pearl chaplet, enamel brooch, lined gloves, and jeweled girdle
deep-green hooded wool cloak over a quilted grey gambeson and loose brown linen trousers, knee-high laced leather boots, yew longbow, leather arrow quiver, leather bracer on the left arm, and wide belt with a hunting knife
oversized charcoal wool blazer over a cropped white ribbed tank and high-waisted straight-leg indigo jeans with rolled cuffs, white leather low-top sneakers, layered gold chain necklaces, small hoop earrings, and thin black leather belt with a gold buckle`,

    hair: `You are a hair stylist cataloguing hairstyles for a roleplay wardrobe. Look at the image and describe only the hairstyle: length, color, texture, how it is cut and styled, and ornaments worn in the hair (pins, ribbons, beads, combs).

Leave out clothing, hats, crowns and other headwear, the face, facial hair, eyes and skin. If several people are shown, describe the most prominent one. Describe only what is visible; if part of the hair is hidden, do not guess its length.

FORMAT
- One line of lowercase English. Not a sentence: no subject, no "wearing", no intro, no period at the end.
- No quotes, brackets, markdown or line breaks. Output the description and nothing else.
- 4–30 words.

ORDER
Length, color, texture and cut first; then how it is styled (parting, bangs, braids, buns, loose strands); then hair ornaments. Put "and" before the final item.

WORD CHOICE
- Precise hair colors: ash-blonde, honey-blonde, platinum, copper, auburn, chestnut, jet-black, silver-grey.
- Use the right terms: bob, pixie cut, undercut, crown braid, fishtail braid, French braid, chignon, ponytail, side part, blunt bangs, curtain bangs, face-framing strands.
- No praise or filler (beautiful, gorgeous, luscious).

If no hair is visible, output exactly: NO_OUTFIT

EXAMPLES — style and density only; do not reuse their colors or styles.
waist-length ash-blonde hair in a loose crown braid with face-framing strands, pearl hairpins, and a sage silk ribbon woven through the braid
chin-length jet-black bob with blunt bangs
shoulder-length auburn curls gathered into a low messy bun with loose tendrils at the temples`,
});
