# Le Sceau des Quatre Veilleurs

Jeu géolocalisé et immersif pour Vadim (12 ans), Louise (14 ans), Soline (9 ans) et Sacha (7 ans), conçu pour Bissey-la-Côte puis Layer-sur-Roche.

## Contenu

- `index.html` : page principale
- `styles.css` : habillage immersif responsive
- `app.js` : jeu, GPS, énigmes, sauvegarde et mode maître du jeu
- `manifest.json` + `sw.js` : fonctionnement PWA / hors connexion après premier chargement

## Mise en ligne

La géolocalisation des navigateurs exige **HTTPS** (ou `localhost` pour tester sur ordinateur). Le site peut être publié tel quel sur GitHub Pages, Netlify, Cloudflare Pages, Vercel ou tout hébergeur HTTPS statique.

Il n’utilise aucune bibliothèque externe et n’envoie aucune position vers un serveur.

## Mode maître du jeu

Touchez le bouton **⚙** en bas à droite.

Code PIN initial : **4826**

Le mode adulte permet :

1. d’enregistrer les coordonnées exactes de la mairie, de l’église, de la fontaine et de la chapelle ;
2. de régler le rayon de déclenchement GPS de chaque étape ;
3. d’exporter les coordonnées au format JSON ;
4. de réimporter ce fichier sur un autre téléphone ;
5. de forcer chaque étape en cas de GPS capricieux ;
6. de changer le code du coffre ;
7. d’effacer la progression.

## Calibrage conseillé sur place

Pour chaque lieu :

1. placez-vous à l’endroit où vous voulez que l’étape se déclenche ;
2. attendez que le téléphone ait une précision correcte ;
3. ouvrez ⚙ > Maître du jeu ;
4. cliquez sur **Utiliser ma position actuelle** ;
5. répétez 2 ou 3 fois si la précision fluctue ;
6. gardez un rayon de 40 à 60 m en extérieur. Montez à 70–90 m si le GPS est instable.

La fontaine est volontairement **sans coordonnées par défaut** afin d’éviter une mauvaise géolocalisation. La mairie, l’église et la chapelle ont des coordonnées indicatives, à recalibrer avant le jour J.

## Fonctionnement de la Marche des Ombres

Les événements intermédiaires ne nécessitent pas de points GPS supplémentaires : ils se déclenchent selon la distance restante jusqu’à la chapelle.

Seuils par défaut :

- Ombre I : 2,3 km
- mémoire montrée à Sacha : 1,5 km
- test avec Vadim : 1,2 km
- fragment de Louise : 800 m
- approche finale : 300 m

Ces seuils sont dans `app.js`, objet `DEFAULT_CONFIG.walkThresholds`, et sont également conservés dans le fichier JSON exporté.

## Codes

- PIN maître du jeu par défaut : `4826`
- code narratif final : `1292`
- code coffre par défaut : `3147` (modifiable dans le mode maître du jeu)

## Test avant le jour J

Faire une répétition adulte complète sur l’itinéraire réel, vérifier la sécurité du chemin vers Layer-sur-Roche et tester les quatre déclenchements géographiques avec le téléphone qui sera utilisé le jour J.
