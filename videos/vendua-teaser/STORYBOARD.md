---
format: 1080x1920
duration: 15s
message: 'Venduá — sua loja viva na palma da mão — está chegando.'
arc: Spark → What it does → Where it lives → The name → Em breve
audience: donos de pequenos negócios de comida (doceiras, marmitarias, hamburguerias, padarias)
mode: collaborative
music: synthesized — warm house-pop, 120 BPM, F major (one beat = 0.5 s, one bar = 2 s)
---

# Venduá — teaser (15 s, 9:16)

Everything sits on one 120 BPM grid. Every cut, word and landing is on a beat or an eighth note,
and the synthesized score and SFX are generated from the same cue sheet (`audio/cues.json`), so
picture and sound cannot drift apart.

Safe zone for Instagram stories: text stays between y 250 and y 1580.

## Frame 1 — Faísca

- scene: The lime V draws itself on deep green, slams on the downbeat, and a ring of light bursts out
- duration: 2s
- transition_in: cut
- status: animated
- asset_candidates: mark-lime.svg
- src: compositions/frames/01-faisca.html

Hook. 0.0–1.0 the V stroke draws on over a rising swell; 1.0 impact (sub boom + crash): the V punches
1.15 → 1 and a lime ring shockwaves out; 1.5 the V breathes; 2.0 cut.

## Frame 2 — O dia

- scene: "Pedidos. Cardápio. Horários. Pix." slam in one per beat, each landing lime then settling cream
- duration: 3s
- transition_in: cut
- status: animated
- asset_candidates: none (typography)
- src: compositions/frames/02-o-dia.html

What it does, from the site's own list. Words land on 2.0 / 2.5 / 3.0 / 3.5 with a pitched blip each
(F-A-C-F up the scale) over the kick; 4.0 the stack holds on the beat; 4.5 the stack whips up and out
with a whoosh.

## Frame 3 — Na palma da mão

- scene: Cream sky; "Sua loja viva / na palma da mão." above a phone that rises and lands on the beat, showing Nena's real home screen
- duration: 3s
- transition_in: whip up
- status: animated
- asset_candidates: inicio-creme-750.webp
- src: compositions/frames/03-palma.html

Where it lives. 5.0 "Sua loja viva", 5.5 "na palma da mão."; the phone swings up out of the bottom
in 3D (swoosh) and wakes on 6.0 (thump + glass tap: black lifts, the UI settles, a sheen crosses the
glass); Core's real push "Pedido #29 chegou" drops in on 6.5 with a two-note ding. 7.0–8.0 build:
snare roll and riser, the camera pushes into Duá on the home screen (a full-resolution Duá is laid over
the screenshot's so it stays sharp); a beat of silence at 7.875 before the drop.

## Frame 4 — venduá.

- scene: Poster-size "venduá." springs up letter by letter; the dot lands on the drop and Duá climbs out from behind the name and waves
- duration: 4s
- transition_in: cut
- status: animated
- asset_candidates: dua-ola.webp
- src: compositions/frames/04-nome.html

The name, as the site hero does it. The drop hits at 8.0 with full groove. Letters spring one per
eighth note, 8.0 → 9.25, each with a rising pop; the accent lands 9.5 (ting); the dot lands 10.0 (big
impact + crash); Duá climbs out 10.0–10.75 and waves 10.75–11.5. "Para doceiras, marmitarias,
hamburguerias e padarias." arrives word by word 10.5–11.75.

## Frame 5 — Em breve

- scene: Deep green: the V and "venduá." above an "Em breve" pill, then an Instagram row (@vendua.digital) and a website row (vendua.com.br), each with a lime icon
- duration: 3s
- transition_in: cut
- status: animated
- asset_candidates: mark-lime.svg
- src: compositions/frames/05-em-breve.html

The call to action and where to find us. 12.0 finale hit and chord stab, drums stop; the pill pops in
with a shimmer; 12.5 the Instagram row lands on the first chime, 12.75 the website row on the second;
13.5 the Instagram icon nudges (a soft pop). The frame holds, readable, to the last frame while the
music fades 14.5–15.0.

## Changes after v1

- User: make the Instagram much clearer, with icons, and show the website vendua.com.br. The handle
  became an icon row, a website row was added, both enlarged, and the end fade was removed so they
  stay on screen.
- User: sharper, better resolution. Rendered at 2160×3840 (CRF 12) and downscaled to a high-bitrate
  1080×1920 upload file; the push-in lands on a full-resolution Duá.
- User: a better phone mockup animation. 3D swing-up, side buttons, glass reflection and sheen, the
  screen wakes on the beat, and the real order push arrives on the next beat.
