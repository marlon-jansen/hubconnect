# HubConnect op Render (gratis, Java)

Deze map is zelfstandig: de Java-backend (`Server.java` + `lib/`) én de webapp (`web/`) zitten erin.
Render bouwt de `Dockerfile` en draait alles als één service — net als een echte server (zoals festivALL).

## Deployen
1. Zet **deze map** (`hubconnect-deploy`) in een Git-repo (GitHub).
2. Op **render.com** → **New + → Web Service** → koppel de repo.
   - Runtime: **Docker** (wordt automatisch herkend via de Dockerfile).
   - Plan: **Free**.
3. Bij **Environment** voeg je 3 variabelen toe:
   - `DB_URL` = `jdbc:postgresql://51.145.115.118:5432/Jumbo`
   - `DB_USER` = `postgres`
   - `DB_PASSWORD` = `Slimstekkie1234`
4. **Create Web Service**. Render bouwt en start; je krijgt een vast adres als
   `https://hubconnect.onrender.com`.
5. Open dat adres → inloggen als `marlon@admin.com` / `Admin!1` → accounts aanmaken.

Werkt daarna op **elk apparaat, overal**, zonder dat jouw laptop aanstaat.

## Goed om te weten
- **Gratis plan valt in slaap** na ~15 min zonder verkeer; de eerste keer daarna duurt het opstarten
  ~30–60s. Tijdens gebruik blijft de service wakker.
- De **poort** komt van Render (`$PORT`) — daar hoef je niets voor te doen.
- DB-gegevens staan **als omgevingsvariabele** op Render, niet in de code (`db.properties` wordt niet
  meegeleverd, staat in `.gitignore`).
- Realtime werkt hier met de directe Java-aanpak; de client pollt elke ~3s op `/api/version`.
- **Beveiliging**: wijzig het DB-wachtwoord zodra je kunt en beperk de toegang tot de database
  (firewall). Pas daarna `DB_PASSWORD` op Render aan.

## Updaten
Verander je iets aan de app of server? Kopieer de gewijzigde bestanden hierheen
(`web/index.html`, `web/styles.css`, `web/js/*`, of `Server.java`), commit + push → Render bouwt opnieuw.
