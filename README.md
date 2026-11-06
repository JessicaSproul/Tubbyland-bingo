# Tubbyland Office Bingo

Office catchphrase bingo. Players sign in, drag Tubbies onto their card, and race each other on the Standings and Winners boards. Everything is free: Firebase (free Spark plan) handles sign-in and saving, and GitHub Pages hosts the page.

## Files

| File | What it is |
|------|------------|
| `index.html` | The page and its styles |
| `app.js` | Game logic, sign-in, saving, boards |
| `phrases.js` | The built-in catchphrase list. Edit this to add or change squares |
| `firebase-config.js` | Your Firebase project settings (step 2) |
| `firestore.rules` | Security rules to paste into Firebase (step 4) |

## Setup (about 15 minutes)

### 1. Create a Firebase project
1. Go to https://console.firebase.google.com and click **Create a project**.
2. Name it (for example `tubbyland-bingo`). You can turn off Google Analytics.
3. Stay on the free **Spark** plan. No credit card needed.

### 2. Connect the page to Firebase
1. In the project, click the **</>** (Web) icon to add a web app. Give it a nickname. Skip Firebase Hosting.
2. Firebase shows a `firebaseConfig` block. Copy the values into `firebase-config.js`.

### 3. Turn on sign-in
1. Go to **Build > Authentication > Get started**.
2. Under **Sign-in method**, enable **Google** (pick a support email) and **Email/Password**.

### 4. Create the database
1. Go to **Build > Firestore Database > Create database**. Pick a location near you and start in **production mode**.
2. Open the **Rules** tab, replace everything with the contents of `firestore.rules`, and click **Publish**.

### 5. Put it on GitHub Pages
1. Create a new repository on GitHub (for example `tubbyland-bingo`).
2. Upload all the files in this folder (**Add file > Upload files**) and commit.
3. Go to **Settings > Pages**. Under **Build and deployment**, choose **Deploy from a branch**, branch `main`, folder `/ (root)`, and save.
4. After a minute, your game is at `https://YOUR-GITHUB-USERNAME.github.io/tubbyland-bingo/`.

On a free GitHub account the repository has to be **public** for Pages to work. Anyone who finds the repo can read the phrase list, but only signed-in players can see the boards.

### 6. Approve your GitHub web address in Firebase
1. In Firebase, go to **Authentication > Settings > Authorized domains**.
2. Click **Add domain** and enter `YOUR-GITHUB-USERNAME.github.io`.

Without this, sign-in shows "This web address isn't approved in Firebase yet."

### 7. Make yourself the admin
Admins see the **Start a new round** button.
1. Open the game and sign in once.
2. In Firebase, go to **Authentication > Users** and copy your **User UID**.
3. Go to **Firestore Database > Data > Start collection**. Collection ID: `admins`. Document ID: paste your UID. Add any field, such as `role` = `admin`. Save.
4. Reload the game. The button appears at the bottom of the Winners board.

### 8. Share it
Send the GitHub Pages link to everyone. They sign in with Google or create an account with their email.

## How the game works
- Each player gets their own card of 24 phrases plus the free Tubby Custard square. The card is the same on every device they sign in from.
- Marks save to the player's account as they go.
- **Standings** shows everyone in the current round. The bar length is squares marked. The color shows their best line: green is warming up, yellow is 3 in a row, red is one away, purple is BINGO.
- **Winners board** lists everyone who got BINGO this round, in order.
- **Start a new round** (admins only) clears the Winners board and deals everyone a fresh card.

## Phrase suggestions
- Anyone signed in can click **Suggest a phrase** under their card and send in a new square.
- Admins see the waiting suggestions at the bottom of the Winners board. Fix any typos in the box, then click **Add to game** or **Dismiss**.
- Added phrases join the pool starting with the next round, so nobody's current card changes. They're saved in Firestore under `phrases`; delete a document there to take one back out.
- If you set the game up before this feature existed, paste the latest `firestore.rules` into Firebase and click **Publish** again, or suggestions won't save.

## Changing phrases
Edit `phrases.js` on GitHub (click the file, then the pencil icon) and commit. Keep at least 24 phrases. The site updates within a minute or two; players may need to refresh.

## Testing on your computer
The page needs to be served, not opened as a file. From this folder run:

```bash
python3 -m http.server 8000
```

Then open http://localhost:8000. Firebase allows `localhost` by default.
