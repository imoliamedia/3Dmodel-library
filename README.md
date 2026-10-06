# Model Library

**NL** · [English below](#english)

Een gratis, volledig lokale bibliotheek voor je 3D-printbestanden (**STL, 3MF, OBJ**). Voeg je bestanden toe, zie meteen thumbnails, bekijk ze in 3D en geef ze een naam, tags en notities, zodat je weer weet wat wat is. Werkt op telefoon, tablet en pc en kan als app geïnstalleerd worden.

- **Niets wordt geüpload.** Alles draait in je browser; er is geen server of account.
- **Je originelen blijven ongemoeid.** De app bewaart een kopie in de browser en voegt enkel een eigen catalogus toe.
- **Opruimmodus:** blader door je naamloze modellen en benoem ze snel (Enter = opslaan en volgende).
- **Back-up:** exporteer alles als `.zip` (ook om van toestel te wisselen) of enkel de catalogus.
- Nederlands en Engels.

## Gebruiken

1. Open de site (bv. via GitHub Pages) en kies *Toevoegen*, of sleep bestanden/mappen in het venster.
2. Tik op een model om te draaien, in te zoomen en een naam, tags en notitie in te vullen.
3. Maak af en toe een back-up via ⚙ Instellingen. Je bibliotheek staat enkel in deze browser; die kan opslag opruimen als er ruimte tekort is (vooral Safari op iPhone/iPad).

Installeren als app: *Toevoegen aan beginscherm* (iOS/Android) of het installatie-icoon in de adresbalk (Chrome/Edge).

## Zelf draaien / hosten

Het is een statische site zonder build-stap.

```bash
python -m http.server 5173
# open http://localhost:5173
```

Voor GitHub Pages: zet de inhoud van deze map op een branch en activeer Pages. Verhoog `VERSION` in `sw.js` na elke wijziging, anders blijven bezoekers de oude offline-cache zien.

## Beperkingen v1

- Mapkeuze werkt niet overal (iOS kiest enkel losse bestanden).
- Bestanden boven 150 MB krijgen geen automatische preview.
- Kleuren in 3MF/OBJ worden grotendeels vervangen door één standaardkleur.
- Een back-up met alle bestanden wordt in het geheugen opgebouwd: bij een zeer grote bibliotheek kan dat zwaar zijn.

## English

A free, fully local library for your 3D-printing files (**STL, 3MF, OBJ**): add files, get instant thumbnails, inspect them in 3D and give them a name, tags and notes so you always know what is what. Works on phone, tablet and desktop and can be installed as an app.

- **Nothing is uploaded.** Everything runs in your browser; no server, no account.
- **Your originals are never touched.** A copy is stored in the browser, plus your own catalog on top.
- **Tidy-up mode:** step through unnamed models and name them quickly (Enter = save and next).
- **Backup:** export everything as a `.zip` (also to switch devices) or just the catalog.
- Dutch and English.

Run it yourself: it is a static site, no build step (`python -m http.server`). For GitHub Pages, publish this folder and bump `VERSION` in `sw.js` after every change.

## Credits

Built with [three.js](https://threejs.org/) (MIT) and [fflate](https://github.com/101arrowz/fflate) (MIT), bundled in `vendor/`.

## License

MIT, see [LICENSE](LICENSE).
