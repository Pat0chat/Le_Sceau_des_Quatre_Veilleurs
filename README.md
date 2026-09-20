# Le Sceau des Quatre Passages — Veuxhaulles-sur-Aube

Aventure géolocalisée conçue pour Vadim (12 ans), Louise (14 ans), Soline (9 ans) et Sacha (7 ans).
Durée visée : environ 2 heures, selon la marche et le temps consacré aux énigmes.

## Parcours

1. Église Saint-Pierre-ès-Liens — Les Yeux de Verre
2. Seuil / étangs — Le Seuil de l’Eau
3. Vieux pont de pierre — Le Passage de Pierre
4. Ancienne tour d’eau ferroviaire — Le Gardien du Fer
5. Retour à l’église — Le Rituel des Quatre

Les coordonnées de l’église sont préremplies à titre indicatif. Les coordonnées du seuil, du pont et de la tour doivent être relevées lors d’une reconnaissance sur place depuis les points exacts où les enfants devront rester.

## Calibrage GPS

Ouvrir le site, puis toucher ⚙.
PIN par défaut : 4826.

Pour chaque étape :
- se placer exactement au point de jeu souhaité ;
- cliquer sur « Utiliser ma position actuelle » ;
- choisir un rayon de déclenchement ;
- enregistrer ;
- exporter la configuration JSON quand tout est prêt.

Conseils : 50 à 70 m pour les lieux faciles à approcher, 70 à 100 m pour la tour afin que l’énigme puisse être jouée à distance des voies.

## Réponses de terrain configurables

Le mode maître du jeu permet de modifier :
- le nombre de vitraux en façade de l’église (3 par défaut) ;
- le nombre d’ouvertures de la barrière au-dessus du seuil d’eau (5 par défaut — à confirmer lors de la reconnaissance) ;
- le nombre d’arches du vieux pont (3 par défaut).

Ces nombres deviennent automatiquement les clés des énigmes adolescentes. Il est donc possible de corriger un comptage sans recoder le site.

## Sécurité

La tour d’eau est utilisée uniquement comme décor visible depuis un point sûr. Le jeu ne demande jamais de marcher sur les voies, de traverser les rails hors d’un passage autorisé, de descendre sur un ouvrage hydraulique, d’entrer dans l’eau ou de grimper sur le pont.

Reconnaître l’intégralité du trajet avec un adulte avant le jour J et calibrer les points GPS sur l’itinéraire réellement retenu.

## Test local sous Windows

Double-cliquer sur `TEST-LOCAL.bat`.
Le navigateur ouvre :

`http://localhost:8080/?test=1`

Un bouton 🧪 apparaît en bas à gauche. Il permet d’ouvrir directement chaque énigme et de simuler l’arrivée GPS à chaque lieu, y compris les étapes qui ne sont pas encore calibrées.

Le service worker est désactivé en mode test local afin qu’un simple F5 recharge les dernières modifications.

## Mise en ligne

Publier le contenu du dossier sur un hébergement HTTPS (GitHub Pages, Netlify, Cloudflare Pages, Vercel…). HTTPS est nécessaire pour la géolocalisation sur smartphone.


## Page d’accueil immersive
La version actuelle s’ouvre sur une véritable page d’accueil distincte du récit. Elle permet d’entrer dans le Livre ou de reprendre une progression sauvegardée. Les décors de fond changent ensuite selon le passage en cours (église, eau, pont, tour, retour et finale), avec brume et effets de profondeur.

## Verrouillage avant le jour J

Dans le mode Maître du jeu (⚙), la section **Verrouillage de l’aventure** permet d’activer un blocage jusqu’à une date et une heure précises. Avant ce moment, la page d’accueil affiche un Livre scellé et un compte à rebours ; les joueurs ne peuvent pas entrer dans l’aventure. Le mode local `?test=1` ignore volontairement ce verrou pour les essais.

La date n’est pas activée par défaut : choisissez-la dans ⚙ avant d’envoyer le lien aux joueurs.
