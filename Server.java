import com.sun.net.httpserver.*;
import com.google.gson.*;
import java.io.*;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.sql.*;
import java.util.*;
import java.util.concurrent.*;

/**
 * HubConnect backend — statische bestanden + state-API + realtime (SSE).
 * De volledige app-staat wordt opgeslagen in ECHTE tabellen per onderdeel (PostgreSQL via JDBC).
 * De server mapt de staat <-> tabellen; de client blijft met /api/state werken.
 *
 * Start: java --class-path "lib/postgresql.jar;lib/gson.jar" Server.java <poort> <webroot> <db.properties>
 */
public class Server {
  static String DB_URL, DB_USER, DB_PASS;
  static String GATE_USER, GATE_PASS;
  static String SESSION_SECRET;                 // HMAC-sleutel voor stateless sessie-tokens
  static final long SESSION_TTL_MS = 12L * 3600 * 1000;   // sessie 12 uur geldig
  static Connection conn;
  static final Object DBLOCK = new Object(); // serialiseert alle DB-toegang (1 gedeelde verbinding)
  static final Gson GSON = new Gson();
  static final List<OutputStream> sseClients = new CopyOnWriteArrayList<>();
  static final java.security.SecureRandom RNG = new java.security.SecureRandom();
  // Eenvoudige brute-force-rem: mislukte inlogpogingen per IP.
  static final Map<String, long[]> loginFails = new ConcurrentHashMap<>(); // ip -> [count, firstTsMs]

  public static void main(String[] args) throws Exception {
    int port = args.length > 0 ? Integer.parseInt(args[0]) : (System.getenv("PORT") != null ? Integer.parseInt(System.getenv("PORT")) : 8210);
    Path webroot = Paths.get(args.length > 1 ? args[1] : ".").toAbsolutePath().normalize();
    String propsPath = args.length > 2 ? args[2] : "db.properties";
    // DB-gegevens: eerst omgevingsvariabelen (Render/cloud), anders db.properties (lokaal).
    Properties p = new Properties();
    try (InputStream in = new FileInputStream(propsPath)) { p.load(in); } catch (Exception ignore) {}
    DB_URL = env("DB_URL", p.getProperty("url"));
    DB_USER = env("DB_USER", p.getProperty("user"));
    DB_PASS = env("DB_PASSWORD", p.getProperty("password"));
    if (DB_URL == null) { System.err.println("Geen DB_URL gevonden (env of db.properties)."); System.exit(1); }
    // Sessie-geheim (HMAC voor inlog-tokens). Zet SESSION_SECRET in de omgeving zodat sessies
    // een herstart overleven; anders genereren we er een (iedereen moet dan na een herstart opnieuw inloggen).
    SESSION_SECRET = env("SESSION_SECRET", p.getProperty("session.secret"));
    if (SESSION_SECRET == null || SESSION_SECRET.length() < 16) {
      byte[] rnd = new byte[32]; RNG.nextBytes(rnd);
      SESSION_SECRET = Base64.getEncoder().encodeToString(rnd);
      System.out.println("LET OP: geen SESSION_SECRET gezet - tijdelijk geheim gegenereerd (gebruikers loggen na elke herstart opnieuw in).");
    }

    initDb();

    HttpServer server = HttpServer.create(new InetSocketAddress(port), 0);
    server.setExecutor(Executors.newCachedThreadPool());
    // Data-API: alleen na inloggen (sessiecontrole in de handlers zelf).
    server.createContext("/api/state", Server::handleState);
    server.createContext("/api/version", Server::handleVersion);
    server.createContext("/api/events", Server::handleEvents);
    // Auth-endpoints (login/register zijn publiek; de rest vereist een sessie).
    server.createContext("/api/login", Server::handleLogin);
    server.createContext("/api/logout", Server::handleLogout);
    server.createContext("/api/me", Server::handleMe);
    server.createContext("/api/register", Server::handleRegister);
    server.createContext("/api/change-password", Server::handleChangePassword);
    server.createContext("/api/set-password", Server::handleSetPassword);
    server.createContext("/api/invite", Server::handleInvite);
    server.createContext("/api/invite-codes", Server::handleInviteCodes);
    server.createContext("/api/reset-password", Server::handleResetPassword);
    server.createContext("/api/reset", Server::handleReset);
    // Statische app (login-scherm zelf) is publiek; de gegevens erachter niet.
    server.createContext("/", ex -> handleStatic(ex, webroot));
    server.start();
    System.out.println("HubConnect server draait op http://localhost:" + port + "  (webroot: " + webroot + ")");
  }

  static synchronized Connection db() throws SQLException {
    if (conn == null || conn.isClosed() || !conn.isValid(2)) conn = DriverManager.getConnection(DB_URL, DB_USER, DB_PASS);
    return conn;
  }

  static void initDb() throws SQLException {
    String[] ddl = {
      "CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT)",
      "CREATE TABLE IF NOT EXISTS hubs (id TEXT PRIMARY KEY, naam TEXT)",
      "CREATE TABLE IF NOT EXISTS task_catalog (naam TEXT PRIMARY KEY, type TEXT, ord INT)",
      "CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, personeelsnummer TEXT, email TEXT, voornaam TEXT, achternaam TEXT, pass TEXT, otp TEXT, must_set_password BOOLEAN, rol TEXT, n2 BOOLEAN, jbt_trainer BOOLEAN, hub_id TEXT, taken JSONB, stats JSONB, hidden BOOLEAN, created_at TEXT)",
      // extra hubs voor een locatie-manager die meerdere hubs bestuurt (toegekend door manager thuisbezorging/beheerder)
      "ALTER TABLE users ADD COLUMN IF NOT EXISTS hub_ids JSONB",
      // buswassing-dienst (v=101) werd niet opgeslagen: kolom toevoegen
      "ALTER TABLE diensten ADD COLUMN IF NOT EXISTS buswassing JSONB",
      // Voedselbank-temperatuurregistratie (retouren koel/diepvries) per shift, in Kwaliteit
      "ALTER TABLE kwaliteit ADD COLUMN IF NOT EXISTS voedselbank JSONB",
      "CREATE TABLE IF NOT EXISTS shifts (id TEXT PRIMARY KEY, aanbieder_id TEXT, hub_id TEXT, datum TEXT, dagdeel TEXT, shifts_bekend BOOLEAN, starttijd TEXT, bus_type TEXT, taak TEXT, status TEXT, overnemer_id TEXT, besluit_door_id TEXT, besluit_op TEXT, reden TEXT, fifo_warning BOOLEAN, fifo_skipped_by TEXT, fifo_skipped_at TEXT, seq BIGINT, aanbied_reden TEXT, created_at TEXT)",
      "CREATE TABLE IF NOT EXISTS task_offers (id TEXT PRIMARY KEY, aanbieder_id TEXT, hub_id TEXT, datum TEXT, dagdeel TEXT, taak TEXT, starttijd TEXT, aanbied_reden TEXT, status TEXT, overnemer_id TEXT, besluit_door_id TEXT, besluit_op TEXT, reden TEXT, created_at TEXT)",
      "CREATE TABLE IF NOT EXISTS backups (id TEXT PRIMARY KEY, aanbieder_id TEXT, hub_id TEXT, datum TEXT, dagdeel TEXT, direction TEXT, toelichting TEXT, rit_omschrijving TEXT, rit_tijd TEXT, status TEXT, overnemer_id TEXT, besluit_door_id TEXT, besluit_op TEXT, reden TEXT, created_at TEXT)",
      "CREATE TABLE IF NOT EXISTS callouts (id TEXT PRIMARY KEY, aanbieder_id TEXT, hub_id TEXT, datum TEXT, dagdeel TEXT, toelichting TEXT, status TEXT, overnemer_id TEXT, besluit_door_id TEXT, besluit_op TEXT, reden TEXT, created_at TEXT)",
      "CREATE TABLE IF NOT EXISTS logs (id TEXT PRIMARY KEY, type TEXT, actie TEXT, ref_id TEXT, door_id TEXT, aanbieder_id TEXT, overnemer_id TEXT, hub_id TEXT, details JSONB, reden TEXT, ts TEXT)",
      "CREATE TABLE IF NOT EXISTS plannings (id TEXT PRIMARY KEY, hub_id TEXT, week_start TEXT, created_at TEXT, rows JSONB, cells JSONB)",
      "CREATE TABLE IF NOT EXISTS schade (hub_id TEXT, datum TEXT, dagdeel TEXT, buses JSONB, steekproeven JSONB, PRIMARY KEY (hub_id, datum, dagdeel))",
      "CREATE TABLE IF NOT EXISTS kwaliteit (hub_id TEXT, datum TEXT, dagdeel TEXT, emballage JSONB, soort JSONB, PRIMARY KEY (hub_id, datum, dagdeel))",
      "CREATE TABLE IF NOT EXISTS lc (hub_id TEXT, datum TEXT, dagdeel TEXT, aantal INT, vakken JSONB, PRIMARY KEY (hub_id, datum, dagdeel))",
      "CREATE TABLE IF NOT EXISTS trolley (hub_id TEXT, datum TEXT, dagdeel TEXT, stock4 INT, stock5 INT, pendels JSONB, PRIMARY KEY (hub_id, datum, dagdeel))",
      "CREATE TABLE IF NOT EXISTS trolley_stock (hub_id TEXT, datum TEXT, stock4 INT, stock5 INT, PRIMARY KEY (hub_id, datum))",
      "CREATE TABLE IF NOT EXISTS diensten (hub_id TEXT, datum TEXT, dagdeel TEXT, schadecontrole JSONB, lc JSONB, kwaliteit JSONB, PRIMARY KEY (hub_id, datum, dagdeel))",
      "CREATE TABLE IF NOT EXISTS invite_codes (code TEXT PRIMARY KEY, hub_id TEXT, created_by TEXT, created_at TEXT, expires_at TEXT, used BOOLEAN, used_by_user_id TEXT)"
    };
    // Migratie: oude trolley_stock (alleen hub_id, geen datum) verwijderen zodat de nieuwe schema-versie wordt aangemaakt.
    try (ResultSet rc = db().getMetaData().getColumns(null, null, "trolley_stock", "datum")) {
      if (!rc.next()) { try (Statement s = db().createStatement()) { s.execute("DROP TABLE IF EXISTS trolley_stock"); } }
    } catch (SQLException ignore) {}
    try (Statement s = db().createStatement()) { for (String q : ddl) s.execute(q); }
    System.out.println("Database verbonden; tabellen gereed.");
  }

  /* ===================== GET: tabellen -> staat ===================== */
  static String buildState() throws SQLException {
    Connection c = db();
    JsonObject root = new JsonObject();

    // hubs
    JsonArray hubs = new JsonArray();
    try (ResultSet r = c.createStatement().executeQuery("SELECT id,naam FROM hubs ORDER BY naam")) {
      while (r.next()) { JsonObject o = new JsonObject(); o.addProperty("id", r.getString("id")); o.addProperty("naam", r.getString("naam")); hubs.add(o); }
    }
    root.add("hubs", hubs);

    // task_catalog + taskTypes
    JsonArray cat = new JsonArray(); JsonObject types = new JsonObject();
    try (ResultSet r = c.createStatement().executeQuery("SELECT naam,type FROM task_catalog ORDER BY ord")) {
      while (r.next()) { cat.add(r.getString("naam")); types.addProperty(r.getString("naam"), r.getString("type")); }
    }
    root.add("taskCatalog", cat); root.add("taskTypes", types);

    // users
    JsonArray users = new JsonArray();
    try (ResultSet r = c.createStatement().executeQuery("SELECT * FROM users")) {
      while (r.next()) {
        JsonObject o = new JsonObject();
        o.addProperty("id", r.getString("id"));
        o.addProperty("personeelsnummer", r.getString("personeelsnummer"));
        o.addProperty("email", r.getString("email"));
        o.addProperty("voornaam", r.getString("voornaam"));
        o.addProperty("achternaam", r.getString("achternaam"));
        // BEWUST NIET meegestuurd naar de client: pass (wachtwoord-hash) en otp (eenmalige code).
        // De server verifieert wachtwoorden zelf; credentials verlaten de server nooit.
        o.addProperty("hasPassword", r.getString("pass") != null && !r.getString("pass").isEmpty());
        o.addProperty("mustSetPassword", r.getBoolean("must_set_password"));
        o.addProperty("rol", r.getString("rol"));
        o.addProperty("n2", r.getBoolean("n2"));
        o.addProperty("jbtTrainer", r.getBoolean("jbt_trainer"));
        o.addProperty("hubId", r.getString("hub_id"));
        o.add("hubIds", parse(r.getString("hub_ids"), "[]"));
        o.add("taken", parse(r.getString("taken"), "[]"));
        o.add("stats", parse(r.getString("stats"), "{}"));
        if (r.getBoolean("hidden")) o.addProperty("hidden", true);
        o.addProperty("createdAt", r.getString("created_at"));
        users.add(o);
      }
    }
    root.add("users", users);

    root.add("shifts", rowsToArray(c, "shifts", new String[][]{
      {"id","s"},{"aanbieder_id","s:aanbiederId"},{"hub_id","s:hubId"},{"datum","s"},{"dagdeel","s"},
      {"shifts_bekend","b:shiftsBekend"},{"starttijd","s"},{"bus_type","s:busType"},{"taak","s"},{"status","s"},
      {"overnemer_id","s:overnemerId"},{"besluit_door_id","s:besluitDoorId"},{"besluit_op","s:besluitOp"},{"reden","s"},
      {"fifo_warning","b:fifoWarning"},{"fifo_skipped_by","s:fifoSkippedBy"},{"fifo_skipped_at","s:fifoSkippedAt"},
      {"seq","n:seq"},{"aanbied_reden","s:aanbiedReden"},{"created_at","s:createdAt"}}));

    root.add("taskOffers", rowsToArray(c, "task_offers", new String[][]{
      {"id","s"},{"aanbieder_id","s:aanbiederId"},{"hub_id","s:hubId"},{"datum","s"},{"dagdeel","s"},{"taak","s"},{"starttijd","s"},
      {"aanbied_reden","s:aanbiedReden"},{"status","s"},{"overnemer_id","s:overnemerId"},{"besluit_door_id","s:besluitDoorId"},
      {"besluit_op","s:besluitOp"},{"reden","s"},{"created_at","s:createdAt"}}));

    root.add("backups", rowsToArray(c, "backups", new String[][]{
      {"id","s"},{"aanbieder_id","s:aanbiederId"},{"hub_id","s:hubId"},{"datum","s"},{"dagdeel","s"},{"direction","s"},
      {"toelichting","s"},{"rit_omschrijving","s:ritOmschrijving"},{"rit_tijd","s:ritTijd"},{"status","s"},
      {"overnemer_id","s:overnemerId"},{"besluit_door_id","s:besluitDoorId"},{"besluit_op","s:besluitOp"},{"reden","s"},{"created_at","s:createdAt"}}));

    root.add("callouts", rowsToArray(c, "callouts", new String[][]{
      {"id","s"},{"aanbieder_id","s:aanbiederId"},{"hub_id","s:hubId"},{"datum","s"},{"dagdeel","s"},{"toelichting","s"},
      {"status","s"},{"overnemer_id","s:overnemerId"},{"besluit_door_id","s:besluitDoorId"},{"besluit_op","s:besluitOp"},{"reden","s"},{"created_at","s:createdAt"}}));

    // logs (met details jsonb) — nieuwste eerst
    JsonArray logs = new JsonArray();
    try (ResultSet r = c.createStatement().executeQuery("SELECT * FROM logs ORDER BY ts DESC")) {
      while (r.next()) {
        JsonObject o = new JsonObject();
        o.addProperty("id", r.getString("id")); o.addProperty("type", r.getString("type")); o.addProperty("actie", r.getString("actie"));
        addNullable(o, "refId", r.getString("ref_id")); addNullable(o, "doorId", r.getString("door_id"));
        addNullable(o, "aanbiederId", r.getString("aanbieder_id")); addNullable(o, "overnemerId", r.getString("overnemer_id"));
        addNullable(o, "hubId", r.getString("hub_id")); o.add("details", parse(r.getString("details"), "{}"));
        o.addProperty("reden", r.getString("reden")); o.addProperty("timestamp", r.getString("ts"));
        logs.add(o);
      }
    }
    root.add("logs", logs);

    // plannings
    JsonArray plannings = new JsonArray();
    try (ResultSet r = c.createStatement().executeQuery("SELECT * FROM plannings")) {
      while (r.next()) {
        JsonObject o = new JsonObject();
        o.addProperty("id", r.getString("id")); o.addProperty("hubId", r.getString("hub_id"));
        o.addProperty("weekStart", r.getString("week_start")); o.addProperty("createdAt", r.getString("created_at"));
        o.add("rows", parse(r.getString("rows"), "[]")); o.add("cells", parse(r.getString("cells"), "{}"));
        plannings.add(o);
      }
    }
    root.add("plannings", plannings);

    // per-shift maps (key = hub|datum|dagdeel)
    root.add("schade", shiftMap(c, "schade", new String[]{"buses","steekproeven"}, new String[]{"[]","[]"}));
    root.add("kwaliteit", shiftMap(c, "kwaliteit", new String[]{"emballage","soort","voedselbank"}, new String[]{"{}","{}","null"}));
    JsonObject lc = new JsonObject();
    try (ResultSet r = c.createStatement().executeQuery("SELECT * FROM lc")) {
      while (r.next()) { JsonObject o = new JsonObject(); o.addProperty("aantal", r.getInt("aantal")); o.add("vakken", parse(r.getString("vakken"), "[]")); lc.add(key(r), o); }
    }
    root.add("lc", lc);
    JsonObject tr = new JsonObject();
    try (ResultSet r = c.createStatement().executeQuery("SELECT * FROM trolley")) {
      while (r.next()) { JsonObject o = new JsonObject(); o.addProperty("stock4", r.getInt("stock4")); o.addProperty("stock5", r.getInt("stock5")); o.add("pendels", parse(r.getString("pendels"), "[]")); tr.add(key(r), o); }
    }
    root.add("trolley", tr);
    JsonObject trs = new JsonObject();
    try (ResultSet r = c.createStatement().executeQuery("SELECT * FROM trolley_stock")) {
      while (r.next()) { JsonObject o = new JsonObject(); o.addProperty("stock4", r.getInt("stock4")); o.addProperty("stock5", r.getInt("stock5")); trs.add(r.getString("hub_id") + "|" + r.getString("datum"), o); }
    }
    root.add("trolleyStock", trs);
    JsonObject di = new JsonObject();
    try (ResultSet r = c.createStatement().executeQuery("SELECT * FROM diensten")) {
      while (r.next()) { JsonObject o = new JsonObject(); o.add("schadecontrole", parse(r.getString("schadecontrole"), "[]")); o.add("lc", parse(r.getString("lc"), "[]")); o.add("kwaliteit", parse(r.getString("kwaliteit"), "[]")); o.add("buswassing", parse(r.getString("buswassing"), "[]")); di.add(key(r), o); }
    }
    root.add("diensten", di);

    // meta
    Map<String, String> meta = readMeta(c);
    if (meta.containsKey("_seq")) root.addProperty("_seq", Long.parseLong(meta.get("_seq")));
    if (meta.containsKey("appversion")) root.addProperty("version", Integer.parseInt(meta.get("appversion")));

    return GSON.toJson(root);
  }

  static JsonArray rowsToArray(Connection c, String table, String[][] cols) throws SQLException {
    JsonArray arr = new JsonArray();
    try (ResultSet r = c.createStatement().executeQuery("SELECT * FROM " + table)) {
      while (r.next()) {
        JsonObject o = new JsonObject();
        for (String[] cm : cols) {
          String col = cm[0]; String spec = cm[1];
          String jsonKey, kind;
          int ci = spec.indexOf(':');
          if (ci >= 0) { kind = spec.substring(0, ci); jsonKey = spec.substring(ci + 1); }
          else { kind = spec; jsonKey = col; }
          if (kind.equals("b")) o.addProperty(jsonKey, r.getBoolean(col));
          else if (kind.equals("n")) { long v = r.getLong(col); if (!r.wasNull()) o.addProperty(jsonKey, v); else o.add(jsonKey, JsonNull.INSTANCE); }
          else addNullable(o, jsonKey, r.getString(col));
        }
        arr.add(o);
      }
    }
    return arr;
  }
  static JsonObject shiftMap(Connection c, String table, String[] jsonCols, String[] defaults) throws SQLException {
    JsonObject map = new JsonObject();
    try (ResultSet r = c.createStatement().executeQuery("SELECT * FROM " + table)) {
      while (r.next()) {
        JsonObject o = new JsonObject();
        for (int i = 0; i < jsonCols.length; i++) o.add(jsonCols[i], parse(r.getString(jsonCols[i]), defaults[i]));
        map.add(key(r), o);
      }
    }
    return map;
  }
  static String key(ResultSet r) throws SQLException { return r.getString("hub_id") + "|" + r.getString("datum") + "|" + r.getString("dagdeel"); }

  /* ===================== PUT: staat -> tabellen ===================== */
  static void saveState(String body, String actorId) throws SQLException {
    JsonObject root = JsonParser.parseString(body).getAsJsonObject();
    Connection c = db();
    // Bestaande gebruikers inlezen VÓÓR het wissen — nodig om credentials te behouden en
    // wijzigingen te autoriseren (de client stuurt geen wachtwoord-hashes/otp meer mee).
    Map<String,JsonObject> existingUsers = loadUsers(c);
    JsonObject actor = actorId != null ? existingUsers.get(actorId) : null;
    boolean prevAuto = c.getAutoCommit();
    c.setAutoCommit(false);
    try (Statement s = c.createStatement()) {
      for (String t : new String[]{"hubs","task_catalog","users","shifts","task_offers","backups","callouts","logs","plannings","schade","kwaliteit","lc","trolley","trolley_stock","diensten"}) s.execute("DELETE FROM " + t);

      // hubs
      for (JsonElement e : arr(root, "hubs")) { JsonObject o = e.getAsJsonObject(); exec(c, "INSERT INTO hubs (id,naam) VALUES (?,?)", o.get("id").getAsString(), str(o,"naam")); }
      // task_catalog + types
      JsonArray cat = arr(root, "taskCatalog"); JsonObject types = obj(root, "taskTypes");
      for (int i = 0; i < cat.size(); i++) { String naam = cat.get(i).getAsString(); String type = types.has(naam) ? types.get(naam).getAsString() : "bezorger"; exec(c, "INSERT INTO task_catalog (naam,type,ord) VALUES (?,?,?)", naam, type, i); }
      // users — server-side geautoriseerd samengevoegd (credentials blijven altijd behouden)
      for (JsonObject o : reconcileUsers(arr(root, "users"), existingUsers, actor)) {
        exec(c, "INSERT INTO users (id,personeelsnummer,email,voornaam,achternaam,pass,otp,must_set_password,rol,n2,jbt_trainer,hub_id,hub_ids,taken,stats,hidden,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?::jsonb,?::jsonb,?::jsonb,?,?)",
          str(o,"id"),str(o,"personeelsnummer"),str(o,"email"),str(o,"voornaam"),str(o,"achternaam"),str(o,"pass"),str(o,"otp"),bool(o,"mustSetPassword"),str(o,"rol"),bool(o,"n2"),bool(o,"jbtTrainer"),str(o,"hubId"),jraw(o,"hubIds","[]"),jraw(o,"taken","[]"),jraw(o,"stats","{}"),bool(o,"hidden"),str(o,"createdAt")); }
      // shifts
      for (JsonElement e : arr(root, "shifts")) { JsonObject o = e.getAsJsonObject();
        exec(c, "INSERT INTO shifts (id,aanbieder_id,hub_id,datum,dagdeel,shifts_bekend,starttijd,bus_type,taak,status,overnemer_id,besluit_door_id,besluit_op,reden,fifo_warning,fifo_skipped_by,fifo_skipped_at,seq,aanbied_reden,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
          str(o,"id"),str(o,"aanbiederId"),str(o,"hubId"),str(o,"datum"),str(o,"dagdeel"),bool(o,"shiftsBekend"),str(o,"starttijd"),str(o,"busType"),str(o,"taak"),str(o,"status"),str(o,"overnemerId"),str(o,"besluitDoorId"),str(o,"besluitOp"),str(o,"reden"),bool(o,"fifoWarning"),str(o,"fifoSkippedBy"),str(o,"fifoSkippedAt"),lng(o,"seq"),str(o,"aanbiedReden"),str(o,"createdAt")); }
      // task_offers
      for (JsonElement e : arr(root, "taskOffers")) { JsonObject o = e.getAsJsonObject();
        exec(c, "INSERT INTO task_offers (id,aanbieder_id,hub_id,datum,dagdeel,taak,starttijd,aanbied_reden,status,overnemer_id,besluit_door_id,besluit_op,reden,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
          str(o,"id"),str(o,"aanbiederId"),str(o,"hubId"),str(o,"datum"),str(o,"dagdeel"),str(o,"taak"),str(o,"starttijd"),str(o,"aanbiedReden"),str(o,"status"),str(o,"overnemerId"),str(o,"besluitDoorId"),str(o,"besluitOp"),str(o,"reden"),str(o,"createdAt")); }
      // backups
      for (JsonElement e : arr(root, "backups")) { JsonObject o = e.getAsJsonObject();
        exec(c, "INSERT INTO backups (id,aanbieder_id,hub_id,datum,dagdeel,direction,toelichting,rit_omschrijving,rit_tijd,status,overnemer_id,besluit_door_id,besluit_op,reden,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
          str(o,"id"),str(o,"aanbiederId"),str(o,"hubId"),str(o,"datum"),str(o,"dagdeel"),str(o,"direction"),str(o,"toelichting"),str(o,"ritOmschrijving"),str(o,"ritTijd"),str(o,"status"),str(o,"overnemerId"),str(o,"besluitDoorId"),str(o,"besluitOp"),str(o,"reden"),str(o,"createdAt")); }
      // callouts
      for (JsonElement e : arr(root, "callouts")) { JsonObject o = e.getAsJsonObject();
        exec(c, "INSERT INTO callouts (id,aanbieder_id,hub_id,datum,dagdeel,toelichting,status,overnemer_id,besluit_door_id,besluit_op,reden,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
          str(o,"id"),str(o,"aanbiederId"),str(o,"hubId"),str(o,"datum"),str(o,"dagdeel"),str(o,"toelichting"),str(o,"status"),str(o,"overnemerId"),str(o,"besluitDoorId"),str(o,"besluitOp"),str(o,"reden"),str(o,"createdAt")); }
      // logs
      for (JsonElement e : arr(root, "logs")) { JsonObject o = e.getAsJsonObject();
        exec(c, "INSERT INTO logs (id,type,actie,ref_id,door_id,aanbieder_id,overnemer_id,hub_id,details,reden,ts) VALUES (?,?,?,?,?,?,?,?,?::jsonb,?,?)",
          str(o,"id"),str(o,"type"),str(o,"actie"),str(o,"refId"),str(o,"doorId"),str(o,"aanbiederId"),str(o,"overnemerId"),str(o,"hubId"),jraw(o,"details","{}"),str(o,"reden"),str(o,"timestamp")); }
      // plannings
      for (JsonElement e : arr(root, "plannings")) { JsonObject o = e.getAsJsonObject();
        exec(c, "INSERT INTO plannings (id,hub_id,week_start,created_at,rows,cells) VALUES (?,?,?,?,?::jsonb,?::jsonb)",
          str(o,"id"),str(o,"hubId"),str(o,"weekStart"),str(o,"createdAt"),jraw(o,"rows","[]"),jraw(o,"cells","{}")); }
      // per-shift
      for (Map.Entry<String,JsonElement> en : obj(root,"schade").entrySet()) { String[] k = en.getKey().split("\\|",3); JsonObject o = en.getValue().getAsJsonObject();
        exec(c, "INSERT INTO schade (hub_id,datum,dagdeel,buses,steekproeven) VALUES (?,?,?,?::jsonb,?::jsonb)", k[0],k[1],k[2],jraw(o,"buses","[]"),jraw(o,"steekproeven","[]")); }
      for (Map.Entry<String,JsonElement> en : obj(root,"kwaliteit").entrySet()) { String[] k = en.getKey().split("\\|",3); JsonObject o = en.getValue().getAsJsonObject();
        exec(c, "INSERT INTO kwaliteit (hub_id,datum,dagdeel,emballage,soort,voedselbank) VALUES (?,?,?,?::jsonb,?::jsonb,?::jsonb)", k[0],k[1],k[2],jraw(o,"emballage","{}"),jraw(o,"soort","{}"),jraw(o,"voedselbank","null")); }
      for (Map.Entry<String,JsonElement> en : obj(root,"lc").entrySet()) { String[] k = en.getKey().split("\\|",3); JsonObject o = en.getValue().getAsJsonObject();
        exec(c, "INSERT INTO lc (hub_id,datum,dagdeel,aantal,vakken) VALUES (?,?,?,?,?::jsonb)", k[0],k[1],k[2],intOf(o,"aantal"),jraw(o,"vakken","[]")); }
      for (Map.Entry<String,JsonElement> en : obj(root,"trolley").entrySet()) { String[] k = en.getKey().split("\\|",3); JsonObject o = en.getValue().getAsJsonObject();
        exec(c, "INSERT INTO trolley (hub_id,datum,dagdeel,stock4,stock5,pendels) VALUES (?,?,?,?,?,?::jsonb)", k[0],k[1],k[2],intOf(o,"stock4"),intOf(o,"stock5"),jraw(o,"pendels","[]")); }
      for (Map.Entry<String,JsonElement> en : obj(root,"trolleyStock").entrySet()) { String[] k = en.getKey().split("\\|",2); JsonObject o = en.getValue().getAsJsonObject();
        exec(c, "INSERT INTO trolley_stock (hub_id,datum,stock4,stock5) VALUES (?,?,?,?)", k[0], k[1], intOf(o,"stock4"), intOf(o,"stock5")); }
      for (Map.Entry<String,JsonElement> en : obj(root,"diensten").entrySet()) { String[] k = en.getKey().split("\\|",3); JsonObject o = en.getValue().getAsJsonObject();
        exec(c, "INSERT INTO diensten (hub_id,datum,dagdeel,schadecontrole,lc,kwaliteit,buswassing) VALUES (?,?,?,?::jsonb,?::jsonb,?::jsonb,?::jsonb)", k[0],k[1],k[2],jraw(o,"schadecontrole","[]"),jraw(o,"lc","[]"),jraw(o,"kwaliteit","[]"),jraw(o,"buswassing","[]")); }

      // meta (_seq, appversion)
      if (root.has("_seq") && !root.get("_seq").isJsonNull()) setMeta(c, "_seq", root.get("_seq").getAsString());
      if (root.has("version") && !root.get("version").isJsonNull()) setMeta(c, "appversion", root.get("version").getAsString());
      c.commit();
      c.setAutoCommit(prevAuto);
    } catch (Exception ex) {
      try { c.rollback(); } catch (Exception ig) {}
      try { c.setAutoCommit(prevAuto); } catch (Exception ig) {}
      try { c.close(); } catch (Exception ig) {} conn = null; // forceer verse verbinding (wist aborted state)
      throw new SQLException(ex.getMessage(), ex);
    }
  }

  static long bumpRev() throws SQLException {
    Connection c = db();
    try (Statement s = c.createStatement()) {
      s.execute("INSERT INTO meta (k,v) VALUES ('rev','1') ON CONFLICT (k) DO UPDATE SET v=(meta.v::bigint+1)::text");
      try (ResultSet r = s.executeQuery("SELECT v FROM meta WHERE k='rev'")) { r.next(); return Long.parseLong(r.getString(1)); }
    }
  }
  static long getRev() throws SQLException {
    try (ResultSet r = db().createStatement().executeQuery("SELECT v FROM meta WHERE k='rev'")) { return r.next() ? Long.parseLong(r.getString(1)) : 0; }
  }
  static boolean hasUsers() throws SQLException {
    try (ResultSet r = db().createStatement().executeQuery("SELECT 1 FROM users LIMIT 1")) { return r.next(); }
  }

  /* ===================== HTTP handlers ===================== */
  static void handleState(HttpExchange ex) throws IOException {
    try {
      secHeaders(ex);
      String m = ex.getRequestMethod();
      if (m.equals("OPTIONS")) { ex.sendResponseHeaders(204, -1); return; }
      String actorId = currentUserId(ex);
      boolean empty; synchronized (DBLOCK) { empty = !hasUsers(); }
      // Eerste installatie (lege DB) mag zonder sessie: de client seedt dan de basisgegevens.
      if (actorId == null && !empty) { sendJson(ex, 401, "{\"error\":\"auth\"}"); return; }
      if (m.equals("GET")) {
        String out;
        synchronized (DBLOCK) { out = hasUsers() ? ("{\"version\":" + getRev() + ",\"data\":" + buildState() + "}") : "{\"empty\":true,\"version\":0}"; }
        sendJson(ex, 200, out);
      } else if (m.equals("PUT")) {
        String cid = query(ex, "cid");
        // Body-limiet tegen geheugen-uitputting (max ~8MB).
        byte[] raw = readLimited(ex.getRequestBody(), 8 * 1024 * 1024);
        if (raw == null) { sendJson(ex, 413, "{\"error\":\"too_large\"}"); return; }
        String body = new String(raw, StandardCharsets.UTF_8);
        long rev;
        synchronized (DBLOCK) { saveState(body, actorId); rev = bumpRev(); }
        broadcast("{\"v\":" + rev + ",\"cid\":\"" + (cid == null ? "" : esc(cid)) + "\"}");
        sendJson(ex, 200, "{\"version\":" + rev + "}");
      } else sendJson(ex, 405, "{\"error\":\"method\"}");
    } catch (Exception e) {
      e.printStackTrace();
      try { sendJson(ex, 500, "{\"error\":\"server\"}"); } catch (IOException ignore) {}
    } finally { ex.close(); }
  }
  static void handleVersion(HttpExchange ex) throws IOException {
    try {
      secHeaders(ex);
      if (ex.getRequestMethod().equals("OPTIONS")) { ex.sendResponseHeaders(204, -1); return; }
      if (currentUserId(ex) == null) { sendJson(ex, 401, "{\"error\":\"auth\"}"); return; }
      long rev; synchronized (DBLOCK) { rev = getRev(); }
      sendJson(ex, 200, "{\"version\":" + rev + "}");
    } catch (Exception e) { try { sendJson(ex, 500, "{\"error\":\"version\"}"); } catch (IOException ignore) {} }
    finally { ex.close(); }
  }
  static void handleEvents(HttpExchange ex) throws IOException {
    secHeaders(ex);
    if (currentUserId(ex) == null) { sendJson(ex, 401, "{\"error\":\"auth\"}"); ex.close(); return; }
    ex.getResponseHeaders().set("Content-Type", "text/event-stream; charset=utf-8");
    ex.getResponseHeaders().set("Cache-Control", "no-cache");
    ex.getResponseHeaders().set("Connection", "keep-alive");
    ex.sendResponseHeaders(200, 0);
    OutputStream out = ex.getResponseBody();
    try {
      out.write("retry: 3000\n\n".getBytes(StandardCharsets.UTF_8)); out.flush();
      sseClients.add(out);
      while (true) { Thread.sleep(20000); synchronized (out) { out.write(": ping\n\n".getBytes(StandardCharsets.UTF_8)); out.flush(); } }
    } catch (Exception e) { } finally { sseClients.remove(out); try { ex.close(); } catch (Exception ignore) {} }
  }
  static void broadcast(String json) {
    byte[] msg = ("event: update\ndata: " + json + "\n\n").getBytes(StandardCharsets.UTF_8);
    for (OutputStream o : sseClients) { try { synchronized (o) { o.write(msg); o.flush(); } } catch (IOException e) { sseClients.remove(o); } }
  }
  static void handleStatic(HttpExchange ex, Path webroot) throws IOException {
    try {
      String path = ex.getRequestURI().getPath();
      if (path.equals("/") || path.isEmpty()) path = "/index.html";
      Path file = webroot.resolve("." + path).normalize();
      if (!file.startsWith(webroot) || !Files.exists(file) || Files.isDirectory(file)) { sendNotFound(ex, webroot); return; }
      byte[] bytes = Files.readAllBytes(file);
      secHeaders(ex);
      ex.getResponseHeaders().set("Content-Type", contentType(file.toString()));
      ex.getResponseHeaders().set("Cache-Control", "no-cache");
      ex.sendResponseHeaders(200, bytes.length);
      ex.getResponseBody().write(bytes);
    } catch (Exception e) { try { sendJson(ex, 500, "{\"error\":\"static\"}"); } catch (IOException ignore) {} } finally { ex.close(); }
  }
  // Onbekend pad (geen bestand op de schijf): custom 404.html tonen i.p.v. kale JSON, met fallback als die ontbreekt.
  static void sendNotFound(HttpExchange ex, Path webroot) throws IOException {
    try {
      Path notFound = webroot.resolve("404.html").normalize();
      if (!Files.exists(notFound)) { sendJson(ex, 404, "{\"error\":\"not found\"}"); return; }
      byte[] bytes = Files.readAllBytes(notFound);
      secHeaders(ex);
      ex.getResponseHeaders().set("Content-Type", "text/html; charset=utf-8");
      ex.getResponseHeaders().set("Cache-Control", "no-cache");
      ex.sendResponseHeaders(404, bytes.length);
      ex.getResponseBody().write(bytes);
    } catch (Exception e) { sendJson(ex, 404, "{\"error\":\"not found\"}"); }
  }

  /* ===================== helpers ===================== */
  static void exec(Connection c, String sql, Object... params) throws SQLException {
    try (PreparedStatement ps = c.prepareStatement(sql)) {
      for (int i = 0; i < params.length; i++) {
        Object p = params[i];
        if (p == null) ps.setObject(i + 1, null);
        else if (p instanceof Boolean) ps.setBoolean(i + 1, (Boolean) p);
        else if (p instanceof Integer) ps.setInt(i + 1, (Integer) p);
        else if (p instanceof Long) ps.setLong(i + 1, (Long) p);
        else ps.setString(i + 1, p.toString());
      }
      ps.executeUpdate();
    }
  }
  static JsonArray arr(JsonObject o, String k) { return (o.has(k) && o.get(k).isJsonArray()) ? o.getAsJsonArray(k) : new JsonArray(); }
  static JsonObject obj(JsonObject o, String k) { return (o.has(k) && o.get(k).isJsonObject()) ? o.getAsJsonObject(k) : new JsonObject(); }
  static String str(JsonObject o, String k) { return (o.has(k) && !o.get(k).isJsonNull()) ? o.get(k).getAsString() : null; }
  static boolean bool(JsonObject o, String k) { try { return o.has(k) && !o.get(k).isJsonNull() && o.get(k).getAsBoolean(); } catch (Exception e) { return false; } }
  static Long lng(JsonObject o, String k) { try { return (o.has(k) && !o.get(k).isJsonNull()) ? o.get(k).getAsLong() : null; } catch (Exception e) { return null; } }
  static Integer intOf(JsonObject o, String k) { try { return (o.has(k) && !o.get(k).isJsonNull()) ? o.get(k).getAsInt() : 0; } catch (Exception e) { return 0; } }
  static String jraw(JsonObject o, String k, String def) { return (o.has(k) && !o.get(k).isJsonNull()) ? o.get(k).toString() : def; }
  static JsonElement parse(String s, String def) { try { return JsonParser.parseString(s == null ? def : s); } catch (Exception e) { return JsonParser.parseString(def); } }
  static void addNullable(JsonObject o, String k, String v) { if (v == null) o.add(k, JsonNull.INSTANCE); else o.addProperty(k, v); }
  static Map<String,String> readMeta(Connection c) throws SQLException { Map<String,String> m = new HashMap<>(); try (ResultSet r = c.createStatement().executeQuery("SELECT k,v FROM meta")) { while (r.next()) m.put(r.getString(1), r.getString(2)); } return m; }
  static void setMeta(Connection c, String k, String v) throws SQLException { exec(c, "INSERT INTO meta (k,v) VALUES (?,?) ON CONFLICT (k) DO UPDATE SET v=EXCLUDED.v", k, v); }

  static String contentType(String f) {
    f = f.toLowerCase();
    if (f.endsWith(".html")) return "text/html; charset=utf-8";
    if (f.endsWith(".css")) return "text/css; charset=utf-8";
    if (f.endsWith(".js")) return "text/javascript; charset=utf-8";
    if (f.endsWith(".json")) return "application/json; charset=utf-8";
    if (f.endsWith(".txt")) return "text/plain; charset=utf-8";
    if (f.endsWith(".svg")) return "image/svg+xml";
    if (f.endsWith(".png")) return "image/png";
    if (f.endsWith(".jpg") || f.endsWith(".jpeg")) return "image/jpeg";
    if (f.endsWith(".ico")) return "image/x-icon";
    return "application/octet-stream";
  }
  // Alleen same-origin (geen open CORS meer). Wel defensieve security-headers.
  static void secHeaders(HttpExchange ex) {
    Headers h = ex.getResponseHeaders();
    h.set("X-Content-Type-Options", "nosniff");
    h.set("X-Frame-Options", "DENY");
    h.set("Referrer-Policy", "no-referrer");
    h.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  }
  // Body lezen met harde limiet (voorkomt geheugen-uitputting). Geeft null bij overschrijding.
  static byte[] readLimited(InputStream in, int max) throws IOException {
    ByteArrayOutputStream buf = new ByteArrayOutputStream();
    byte[] tmp = new byte[8192]; int n, total = 0;
    while ((n = in.read(tmp)) != -1) { total += n; if (total > max) return null; buf.write(tmp, 0, n); }
    return buf.toByteArray();
  }

  /* ===================== Auth: wachtwoord-hashing ===================== */
  // Nieuw formaat: pbkdf2$<iteraties>$<salt-b64>$<hash-b64>. Oud (legacy) formaat: kale DJB2-hex.
  static String pbkdf2(String password) {
    try {
      byte[] salt = new byte[16]; RNG.nextBytes(salt);
      int iter = 210000;
      byte[] hash = pbkdf2Raw(password, salt, iter, 32);
      return "pbkdf2$" + iter + "$" + Base64.getEncoder().encodeToString(salt) + "$" + Base64.getEncoder().encodeToString(hash);
    } catch (Exception e) { throw new RuntimeException(e); }
  }
  static byte[] pbkdf2Raw(String password, byte[] salt, int iter, int len) throws Exception {
    javax.crypto.spec.PBEKeySpec spec = new javax.crypto.spec.PBEKeySpec(password.toCharArray(), salt, iter, len * 8);
    return javax.crypto.SecretKeyFactory.getInstance("PBKDF2WithHmacSHA256").generateSecret(spec).getEncoded();
  }
  // DJB2 identiek aan de oude client-hash (voor compatibiliteit met bestaande wachtwoorden).
  static String djb2(String str) {
    int h = 5381;
    for (int i = str.length() - 1; i >= 0; i--) h = (h * 33) ^ str.charAt(i);
    return Integer.toHexString(h);
  }
  static boolean verifyPassword(String stored, String password) {
    if (stored == null || password == null) return false;
    if (stored.startsWith("pbkdf2$")) {
      try {
        String[] p = stored.split("\\$");
        int iter = Integer.parseInt(p[1]);
        byte[] salt = Base64.getDecoder().decode(p[2]);
        byte[] want = Base64.getDecoder().decode(p[3]);
        byte[] got = pbkdf2Raw(password, salt, iter, want.length);
        return java.security.MessageDigest.isEqual(got, want);
      } catch (Exception e) { return false; }
    }
    // legacy DJB2 (constant-time vergelijking van de hex)
    return constEq(stored, djb2(password));
  }

  /* ===================== Auth: sessie-tokens (stateless, HMAC) ===================== */
  static String makeToken(String userId) {
    long exp = System.currentTimeMillis() + SESSION_TTL_MS;
    String payload = userId + "|" + exp;
    String p64 = Base64.getUrlEncoder().withoutPadding().encodeToString(payload.getBytes(StandardCharsets.UTF_8));
    return p64 + "." + hmac(p64);
  }
  static String currentUserId(HttpExchange ex) {
    String tok = cookie(ex, "hc_session");
    if (tok == null) return null;
    int dot = tok.lastIndexOf('.');
    if (dot < 0) return null;
    String p64 = tok.substring(0, dot), sig = tok.substring(dot + 1);
    if (!constEq(sig, hmac(p64))) return null;
    try {
      String payload = new String(Base64.getUrlDecoder().decode(p64), StandardCharsets.UTF_8);
      String[] parts = payload.split("\\|");
      long exp = Long.parseLong(parts[1]);
      if (System.currentTimeMillis() > exp) return null;
      return parts[0];
    } catch (Exception e) { return null; }
  }
  static String hmac(String data) {
    try {
      javax.crypto.Mac mac = javax.crypto.Mac.getInstance("HmacSHA256");
      mac.init(new javax.crypto.spec.SecretKeySpec(SESSION_SECRET.getBytes(StandardCharsets.UTF_8), "HmacSHA256"));
      return Base64.getUrlEncoder().withoutPadding().encodeToString(mac.doFinal(data.getBytes(StandardCharsets.UTF_8)));
    } catch (Exception e) { throw new RuntimeException(e); }
  }
  static void setSessionCookie(HttpExchange ex, String token) {
    ex.getResponseHeaders().add("Set-Cookie", "hc_session=" + token + "; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=" + (SESSION_TTL_MS / 1000));
  }
  static void clearSessionCookie(HttpExchange ex) {
    ex.getResponseHeaders().add("Set-Cookie", "hc_session=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0");
  }
  static String cookie(HttpExchange ex, String name) {
    List<String> hs = ex.getRequestHeaders().get("Cookie");
    if (hs == null) return null;
    for (String line : hs) for (String kv : line.split(";")) {
      String s = kv.trim(); int eq = s.indexOf('=');
      if (eq > 0 && s.substring(0, eq).equals(name)) return s.substring(eq + 1);
    }
    return null;
  }

  /* ===================== Auth: gebruikers-DB-helpers ===================== */
  // Hub waarvoor deze gebruiker werkt: eigen hub, tenzij een rol boven de hubs een andere hub kiest.
  static String scopedHub(JsonObject me, String wanted) {
    if (wanted == null || wanted.isEmpty()) return str(me, "hubId");
    boolean overHubs = "admin".equals(str(me, "rol")) || roleLevel(str(me, "rol")) >= 6;
    if (overHubs) return wanted;
    // locatie-manager met meerdere hubs: alleen een hub uit de eigen lijst
    if (me.has("hubIds") && me.get("hubIds").isJsonArray())
      for (JsonElement e : me.getAsJsonArray("hubIds")) if (wanted.equals(e.getAsString())) return wanted;
    return str(me, "hubId");
  }
  static int roleLevel(String rol) {
    if ("admin".equals(rol)) return 99;
    if ("manager-thuisbezorging".equals(rol)) return 6;
    if ("locatie-manager".equals(rol)) return 5;
    if ("teamleider".equals(rol)) return 4;
    if ("senior".equals(rol)) return 3;
    if ("bezorger".equals(rol)) return 2;
    return 0;
  }
  // Alle gebruikers als JsonObject (met pass/otp) — vorm zoals de INSERT verwacht.
  static Map<String,JsonObject> loadUsers(Connection c) throws SQLException {
    Map<String,JsonObject> m = new HashMap<>();
    try (ResultSet r = c.createStatement().executeQuery("SELECT * FROM users")) {
      while (r.next()) {
        JsonObject o = new JsonObject();
        o.addProperty("id", r.getString("id"));
        addNullable(o, "personeelsnummer", r.getString("personeelsnummer"));
        addNullable(o, "email", r.getString("email"));
        addNullable(o, "voornaam", r.getString("voornaam"));
        addNullable(o, "achternaam", r.getString("achternaam"));
        addNullable(o, "pass", r.getString("pass"));
        addNullable(o, "otp", r.getString("otp"));
        o.addProperty("mustSetPassword", r.getBoolean("must_set_password"));
        addNullable(o, "rol", r.getString("rol"));
        o.addProperty("n2", r.getBoolean("n2"));
        o.addProperty("jbtTrainer", r.getBoolean("jbt_trainer"));
        addNullable(o, "hubId", r.getString("hub_id"));
        o.add("hubIds", parse(r.getString("hub_ids"), "[]"));
        o.add("taken", parse(r.getString("taken"), "[]"));
        o.add("stats", parse(r.getString("stats"), "{}"));
        o.addProperty("hidden", r.getBoolean("hidden"));
        addNullable(o, "createdAt", r.getString("created_at"));
        m.put(r.getString("id"), o);
      }
    }
    return m;
  }
  static JsonObject findUserByLogin(Connection c, String identifier) throws SQLException {
    String id = identifier == null ? "" : identifier.trim();
    // exact e-mail (case-insensitive) of personeelsnummer
    try (PreparedStatement ps = c.prepareStatement("SELECT * FROM users WHERE lower(email)=lower(?) OR personeelsnummer=? LIMIT 1")) {
      ps.setString(1, id); ps.setString(2, id.replaceAll("\\D", ""));
      try (ResultSet r = ps.executeQuery()) {
        if (!r.next()) return null;
        // zelfde vorm als loadUsers
        JsonObject o = new JsonObject();
        o.addProperty("id", r.getString("id"));
        addNullable(o, "personeelsnummer", r.getString("personeelsnummer"));
        addNullable(o, "email", r.getString("email"));
        addNullable(o, "voornaam", r.getString("voornaam"));
        addNullable(o, "achternaam", r.getString("achternaam"));
        addNullable(o, "pass", r.getString("pass"));
        addNullable(o, "otp", r.getString("otp"));
        o.addProperty("mustSetPassword", r.getBoolean("must_set_password"));
        addNullable(o, "rol", r.getString("rol"));
        o.addProperty("n2", r.getBoolean("n2"));
        o.addProperty("jbtTrainer", r.getBoolean("jbt_trainer"));
        addNullable(o, "hubId", r.getString("hub_id"));
        o.add("hubIds", parse(r.getString("hub_ids"), "[]"));
        o.add("taken", parse(r.getString("taken"), "[]"));
        o.add("stats", parse(r.getString("stats"), "{}"));
        o.addProperty("hidden", r.getBoolean("hidden"));
        addNullable(o, "createdAt", r.getString("created_at"));
        return o;
      }
    }
  }
  // Veilige projectie van een gebruiker voor de client (nooit pass/otp).
  static JsonObject safeUser(JsonObject u) {
    JsonObject o = new JsonObject();
    for (String k : new String[]{"id","personeelsnummer","email","voornaam","achternaam","rol","hubId","createdAt"}) if (u.has(k)) o.add(k, u.get(k));
    o.addProperty("mustSetPassword", u.has("mustSetPassword") && !u.get("mustSetPassword").isJsonNull() && u.get("mustSetPassword").getAsBoolean());
    o.addProperty("n2", u.has("n2") && !u.get("n2").isJsonNull() && u.get("n2").getAsBoolean());
    o.addProperty("jbtTrainer", u.has("jbtTrainer") && !u.get("jbtTrainer").isJsonNull() && u.get("jbtTrainer").getAsBoolean());
    if (u.has("taken")) o.add("taken", u.get("taken"));
    if (u.has("stats")) o.add("stats", u.get("stats"));
    return o;
  }

  /* ===================== Auth: gebruikers-reconciliatie (autorisatie bij PUT) =====================
     De client stuurt de hele staat; de server bepaalt welke wijzigingen aan gebruikers zijn toegestaan.
     Credentials (pass/otp/mustSetPassword) komen ALTIJD uit de bestaande DB, nooit van de client. */
  static List<JsonObject> reconcileUsers(JsonArray incoming, Map<String,JsonObject> existing, JsonObject actor) {
    // Bootstrap: lege gebruikerstabel (eerste installatie) → neem de aangeleverde seed 1-op-1 over.
    if (existing.isEmpty()) {
      List<JsonObject> all = new ArrayList<>();
      for (JsonElement e : incoming) if (e.isJsonObject()) all.add(e.getAsJsonObject());
      return all;
    }
    int lvl = actor != null ? roleLevel(str(actor, "rol")) : 0;
    boolean isAdmin = actor != null && "admin".equals(str(actor, "rol"));
    boolean canTeam = isAdmin || lvl >= 4;   // teamleider+ : n2/jbt/taken/naam/e-mail van anderen, aanmaken/verwijderen
    boolean canRoles = isAdmin || lvl >= 5;  // locatie-manager+ : functie en hub
    String actorId = actor != null ? str(actor, "id") : null;

    Map<String,JsonObject> out = new LinkedHashMap<>();
    Set<String> seen = new HashSet<>();
    for (JsonElement e : incoming) {
      if (!e.isJsonObject()) continue;
      JsonObject in = e.getAsJsonObject();
      String id = str(in, "id"); if (id == null) continue;
      seen.add(id);
      JsonObject ex = existing.get(id);
      if (ex == null) {
        // Nieuwe gebruiker via de volledige-staat-PUT: alleen teamleider+ mag dit; nooit met credentials.
        if (!canTeam) continue;
        JsonObject u = new JsonObject();
        for (String k : new String[]{"id","personeelsnummer","email","voornaam","achternaam","rol","hubId","createdAt"}) if (in.has(k)) u.add(k, in.get(k));
        u.add("taken", in.has("taken") ? in.get("taken") : parse("[]", "[]"));
        u.add("hubIds", (isAdmin || lvl >= 6) && in.has("hubIds") ? in.get("hubIds") : parse("[]", "[]"));
        u.add("stats", in.has("stats") ? in.get("stats") : parse("{}", "{}"));
        u.addProperty("n2", bool(in, "n2")); u.addProperty("jbtTrainer", bool(in, "jbtTrainer"));
        u.add("pass", JsonNull.INSTANCE); u.add("otp", JsonNull.INSTANCE); u.addProperty("mustSetPassword", true);
        u.addProperty("hidden", false);
        out.put(id, u);
      } else {
        out.put(id, mergeUser(ex, in, actorId, canTeam, canRoles, isAdmin, lvl));
      }
    }
    // Bestaande gebruikers die ontbreken in de PUT = verwijderpoging: alleen teamleider+ mag verwijderen,
    // en niemand behalve de beheerder mag een verborgen account (superadmin) verwijderen.
    for (Map.Entry<String,JsonObject> en : existing.entrySet()) {
      if (seen.contains(en.getKey())) continue;
      JsonObject ex = en.getValue();
      boolean hidden = bool(ex, "hidden");
      if (!canTeam || (hidden && !isAdmin)) out.put(en.getKey(), ex); // niet toegestaan -> behouden
    }
    return new ArrayList<>(out.values());
  }
  static JsonObject mergeUser(JsonObject ex, JsonObject in, String actorId, boolean canTeam, boolean canRoles, boolean isAdmin, int actorLevel) {
    JsonObject u = new JsonObject();
    u.addProperty("id", str(ex, "id"));
    // credentials: altijd uit de DB
    u.add("pass", ex.has("pass") ? ex.get("pass") : JsonNull.INSTANCE);
    u.add("otp", ex.has("otp") ? ex.get("otp") : JsonNull.INSTANCE);
    u.addProperty("mustSetPassword", bool(ex, "mustSetPassword"));
    u.addProperty("createdAt", str(ex, "createdAt"));  // niet wijzigbaar
    boolean self = actorId != null && actorId.equals(str(ex, "id"));
    // naam + e-mail: eigenaar zelf of teamleider+
    u.addProperty("voornaam", (self || canTeam) ? str(in, "voornaam") : str(ex, "voornaam"));
    u.addProperty("achternaam", (self || canTeam) ? str(in, "achternaam") : str(ex, "achternaam"));
    u.addProperty("email", (self || canTeam) ? str(in, "email") : str(ex, "email"));
    // HR-nummer: alleen de beheerder
    u.addProperty("personeelsnummer", isAdmin ? str(in, "personeelsnummer") : str(ex, "personeelsnummer"));
    // functie + hub: locatie-manager+; nooit een functie boven je eigen niveau toekennen (behalve de beheerder)
    boolean rolOk = canRoles && (isAdmin || roleLevel(str(in, "rol")) <= actorLevel);
    u.addProperty("rol", rolOk ? str(in, "rol") : str(ex, "rol"));
    u.addProperty("hubId", canRoles ? str(in, "hubId") : str(ex, "hubId"));
    // extra hubs van een locatie-manager: alleen rollen boven de hubs (manager thuisbezorging, beheerder)
    boolean overHubs = isAdmin || actorLevel >= 6;
    u.add("hubIds", overHubs && in.has("hubIds") ? in.get("hubIds") : (ex.has("hubIds") ? ex.get("hubIds") : parse("[]", "[]")));
    // bus/JBT/taken: teamleider+
    u.addProperty("n2", canTeam ? bool(in, "n2") : bool(ex, "n2"));
    u.addProperty("jbtTrainer", canTeam ? bool(in, "jbtTrainer") : bool(ex, "jbtTrainer"));
    u.add("taken", canTeam && in.has("taken") ? in.get("taken") : ex.get("taken"));
    // hidden: alleen de beheerder
    u.addProperty("hidden", isAdmin ? bool(in, "hidden") : bool(ex, "hidden"));
    // stats: operationeel (gamification) — overnemen indien meegestuurd
    u.add("stats", in.has("stats") ? in.get("stats") : ex.get("stats"));
    return u;
  }

  /* ===================== Auth: HTTP-handlers ===================== */
  static void handleLogin(HttpExchange ex) throws IOException {
    try {
      secHeaders(ex);
      if (!ex.getRequestMethod().equals("POST")) { sendJson(ex, 405, "{\"error\":\"method\"}"); return; }
      String ip = clientIp(ex);
      if (loginLocked(ip)) { sendJson(ex, 429, "{\"error\":\"too_many\"}"); return; }
      byte[] raw = readLimited(ex.getRequestBody(), 64 * 1024);
      if (raw == null) { sendJson(ex, 413, "{\"error\":\"too_large\"}"); return; }
      JsonObject b = JsonParser.parseString(new String(raw, StandardCharsets.UTF_8)).getAsJsonObject();
      String identifier = str(b, "identifier"), password = str(b, "password");
      JsonObject u;
      synchronized (DBLOCK) {
        u = findUserByLogin(db(), identifier);
        boolean ok = false, upgrade = false;
        if (u != null) {
          String pass = str(u, "pass"), otp = str(u, "otp");
          if (pass != null && verifyPassword(pass, password)) { ok = true; upgrade = !pass.startsWith("pbkdf2$"); }
          else if (otp != null && password != null && otp.equalsIgnoreCase(password.trim())) { ok = true; } // eenmalige code
        }
        if (!ok) { loginFail(ip); sendJson(ex, 401, "{\"error\":\"invalid\"}"); return; }
        if (upgrade) { exec(db(), "UPDATE users SET pass=? WHERE id=?", pbkdf2(password), str(u, "id")); }
        loginOk(ip);
      }
      setSessionCookie(ex, makeToken(str(u, "id")));
      sendJson(ex, 200, "{\"user\":" + GSON.toJson(safeUser(u)) + "}");
    } catch (Exception e) { try { sendJson(ex, 400, "{\"error\":\"bad_request\"}"); } catch (IOException ig) {} }
    finally { ex.close(); }
  }
  static void handleLogout(HttpExchange ex) throws IOException {
    try { secHeaders(ex); clearSessionCookie(ex); sendJson(ex, 200, "{\"ok\":true}"); } finally { ex.close(); }
  }
  static void handleMe(HttpExchange ex) throws IOException {
    try {
      secHeaders(ex);
      String id = currentUserId(ex);
      if (id == null) { sendJson(ex, 401, "{\"error\":\"auth\"}"); return; }
      JsonObject u; synchronized (DBLOCK) { u = loadUsers(db()).get(id); }
      if (u == null) { clearSessionCookie(ex); sendJson(ex, 401, "{\"error\":\"auth\"}"); return; }
      sendJson(ex, 200, "{\"user\":" + GSON.toJson(safeUser(u)) + "}");
    } catch (Exception e) { try { sendJson(ex, 500, "{\"error\":\"server\"}"); } catch (IOException ig) {} }
    finally { ex.close(); }
  }
  static void handleChangePassword(HttpExchange ex) throws IOException {
    try {
      secHeaders(ex);
      if (!ex.getRequestMethod().equals("POST")) { sendJson(ex, 405, "{\"error\":\"method\"}"); return; }
      String id = currentUserId(ex);
      if (id == null) { sendJson(ex, 401, "{\"error\":\"auth\"}"); return; }
      byte[] raw = readLimited(ex.getRequestBody(), 64 * 1024); if (raw == null) { sendJson(ex, 413, "{\"error\":\"too_large\"}"); return; }
      JsonObject b = JsonParser.parseString(new String(raw, StandardCharsets.UTF_8)).getAsJsonObject();
      String oldPw = str(b, "oldPassword"), newPw = str(b, "newPassword");
      if (newPw == null || newPw.length() < 4) { sendJson(ex, 400, "{\"error\":\"weak\"}"); return; }
      synchronized (DBLOCK) {
        JsonObject u = loadUsers(db()).get(id);
        if (u == null) { sendJson(ex, 401, "{\"error\":\"auth\"}"); return; }
        String pass = str(u, "pass");
        if (pass != null && !verifyPassword(pass, oldPw)) { sendJson(ex, 400, "{\"error\":\"wrong_old\"}"); return; }
        exec(db(), "UPDATE users SET pass=?, otp=NULL, must_set_password=false WHERE id=?", pbkdf2(newPw), id);
      }
      sendJson(ex, 200, "{\"ok\":true}");
    } catch (Exception e) { try { sendJson(ex, 400, "{\"error\":\"bad_request\"}"); } catch (IOException ig) {} }
    finally { ex.close(); }
  }
  static void handleSetPassword(HttpExchange ex) throws IOException {
    try {
      secHeaders(ex);
      if (!ex.getRequestMethod().equals("POST")) { sendJson(ex, 405, "{\"error\":\"method\"}"); return; }
      String id = currentUserId(ex);
      if (id == null) { sendJson(ex, 401, "{\"error\":\"auth\"}"); return; }
      byte[] raw = readLimited(ex.getRequestBody(), 64 * 1024); if (raw == null) { sendJson(ex, 413, "{\"error\":\"too_large\"}"); return; }
      JsonObject b = JsonParser.parseString(new String(raw, StandardCharsets.UTF_8)).getAsJsonObject();
      String newPw = str(b, "newPassword");
      if (newPw == null || newPw.length() < 4) { sendJson(ex, 400, "{\"error\":\"weak\"}"); return; }
      synchronized (DBLOCK) {
        JsonObject u = loadUsers(db()).get(id);
        if (u == null) { sendJson(ex, 401, "{\"error\":\"auth\"}"); return; }
        if (!bool(u, "mustSetPassword")) { sendJson(ex, 400, "{\"error\":\"not_allowed\"}"); return; }
        exec(db(), "UPDATE users SET pass=?, otp=NULL, must_set_password=false WHERE id=?", pbkdf2(newPw), id);
      }
      sendJson(ex, 200, "{\"ok\":true}");
    } catch (Exception e) { try { sendJson(ex, 400, "{\"error\":\"bad_request\"}"); } catch (IOException ig) {} }
    finally { ex.close(); }
  }
  static void handleRegister(HttpExchange ex) throws IOException {
    try {
      secHeaders(ex);
      if (!ex.getRequestMethod().equals("POST")) { sendJson(ex, 405, "{\"error\":\"method\"}"); return; }
      byte[] raw = readLimited(ex.getRequestBody(), 64 * 1024); if (raw == null) { sendJson(ex, 413, "{\"error\":\"too_large\"}"); return; }
      JsonObject b = JsonParser.parseString(new String(raw, StandardCharsets.UTF_8)).getAsJsonObject();
      String code = str(b, "code"), voornaam = str(b, "voornaam"), achternaam = str(b, "achternaam");
      String num = str(b, "personeelsnummer"); if (num != null) num = num.replaceAll("\\D", "");
      String email = str(b, "email"); if (email != null) email = email.trim().toLowerCase();
      String pw = str(b, "wachtwoord");
      if (voornaam == null || achternaam == null || voornaam.trim().isEmpty() || achternaam.trim().isEmpty()) { sendJson(ex, 400, "{\"error\":\"naam\"}"); return; }
      if (num == null || num.length() < 4) { sendJson(ex, 400, "{\"error\":\"hr\"}"); return; }
      if (email == null || !email.matches("^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$")) { sendJson(ex, 400, "{\"error\":\"email\"}"); return; }
      if (pw == null || pw.length() < 4) { sendJson(ex, 400, "{\"error\":\"weak\"}"); return; }
      String newId;
      synchronized (DBLOCK) {
        Connection c = db();
        // code valideren
        String hubId = null; boolean valid = false;
        try (PreparedStatement ps = c.prepareStatement("SELECT hub_id,expires_at,used FROM invite_codes WHERE code=?")) {
          ps.setString(1, code == null ? "" : code.trim().toUpperCase());
          try (ResultSet r = ps.executeQuery()) {
            if (r.next() && !r.getBoolean("used")) {
              String exp = r.getString("expires_at");
              if (exp == null || exp.compareTo(java.time.Instant.now().toString()) > 0) { valid = true; hubId = r.getString("hub_id"); }
            }
          }
        }
        if (!valid) { sendJson(ex, 400, "{\"error\":\"code\"}"); return; }
        // duplicaten
        try (PreparedStatement ps = c.prepareStatement("SELECT 1 FROM users WHERE lower(email)=lower(?)")) { ps.setString(1, email); try (ResultSet r = ps.executeQuery()) { if (r.next()) { sendJson(ex, 400, "{\"error\":\"email_bestaat\"}"); return; } } }
        newId = "usr_" + Long.toString(System.currentTimeMillis(), 36) + "_" + Integer.toString(RNG.nextInt(1 << 20), 36);
        exec(c, "INSERT INTO users (id,personeelsnummer,email,voornaam,achternaam,pass,otp,must_set_password,rol,n2,jbt_trainer,hub_id,taken,stats,hidden,created_at) VALUES (?,?,?,?,?,?,NULL,false,'bezorger',false,false,?,'[]'::jsonb,?::jsonb,false,?)",
          newId, num, email, voornaam.trim(), achternaam.trim(), pbkdf2(pw), hubId, "{\"shiftsAangeboden\":0,\"shiftsOvergenomen\":0,\"takenAangeboden\":0,\"takenOvergenomen\":0}", java.time.Instant.now().toString());
        exec(c, "UPDATE invite_codes SET used=true, used_by_user_id=? WHERE code=?", newId, code.trim().toUpperCase());
        bumpRev();
        JsonObject u = loadUsers(c).get(newId);
        setSessionCookie(ex, makeToken(newId));
        sendJson(ex, 200, "{\"user\":" + GSON.toJson(safeUser(u)) + "}");
        broadcast("{\"v\":" + getRev() + ",\"cid\":\"\"}");
        return;
      }
    } catch (Exception e) { try { sendJson(ex, 400, "{\"error\":\"bad_request\"}"); } catch (IOException ig) {} }
    finally { ex.close(); }
  }
  static void handleInvite(HttpExchange ex) throws IOException {
    try {
      secHeaders(ex);
      if (!ex.getRequestMethod().equals("POST")) { sendJson(ex, 405, "{\"error\":\"method\"}"); return; }
      String id = currentUserId(ex); if (id == null) { sendJson(ex, 401, "{\"error\":\"auth\"}"); return; }
      String out;
      synchronized (DBLOCK) {
        JsonObject me = loadUsers(db()).get(id);
        if (me == null || roleLevel(str(me, "rol")) < 4) { sendJson(ex, 403, "{\"error\":\"forbidden\"}"); return; }
        // Rollen boven de hubs (manager thuisbezorging, beheerder) mogen een code voor een gekozen hub maken.
        String hub = scopedHub(me, query(ex, "hubId"));
        String code = genCode();
        String created = java.time.Instant.now().toString();
        String exp = java.time.Instant.now().plusSeconds(7 * 24 * 3600).toString();
        exec(db(), "INSERT INTO invite_codes (code,hub_id,created_by,created_at,expires_at,used,used_by_user_id) VALUES (?,?,?,?,?,false,NULL)",
          code, hub, id, created, exp);
        out = "{\"code\":\"" + esc(code) + "\",\"hubId\":\"" + esc(hub) + "\",\"expiresAt\":\"" + esc(exp) + "\"}";
      }
      sendJson(ex, 200, out);
    } catch (Exception e) { try { sendJson(ex, 500, "{\"error\":\"server\"}"); } catch (IOException ig) {} }
    finally { ex.close(); }
  }
  static void handleInviteCodes(HttpExchange ex) throws IOException {
    try {
      secHeaders(ex);
      String id = currentUserId(ex); if (id == null) { sendJson(ex, 401, "{\"error\":\"auth\"}"); return; }
      if (ex.getRequestMethod().equals("DELETE") || (ex.getRequestMethod().equals("POST") && "revoke".equals(query(ex, "action")))) {
        String code = query(ex, "code");
        synchronized (DBLOCK) {
          JsonObject me = loadUsers(db()).get(id);
          if (me == null || roleLevel(str(me, "rol")) < 4) { sendJson(ex, 403, "{\"error\":\"forbidden\"}"); return; }
          exec(db(), "DELETE FROM invite_codes WHERE code=?", code == null ? "" : code);
        }
        sendJson(ex, 200, "{\"ok\":true}"); return;
      }
      // GET: openstaande codes voor één hub — de eigen hub, of (manager/beheerder) de gekozen hub via ?hubId=
      JsonArray arr = new JsonArray();
      synchronized (DBLOCK) {
        JsonObject me = loadUsers(db()).get(id);
        if (me == null || roleLevel(str(me, "rol")) < 4) { sendJson(ex, 403, "{\"error\":\"forbidden\"}"); return; }
        String hub = scopedHub(me, query(ex, "hubId"));
        String now = java.time.Instant.now().toString();
        try (ResultSet r = db().createStatement().executeQuery("SELECT code,hub_id,expires_at FROM invite_codes WHERE used=false")) {
          while (r.next()) {
            String exp = r.getString("expires_at");
            if (exp != null && exp.compareTo(now) <= 0) continue;
            if (!java.util.Objects.equals(r.getString("hub_id"), hub)) continue;
            JsonObject o = new JsonObject(); o.addProperty("code", r.getString("code")); o.addProperty("hubId", r.getString("hub_id")); o.addProperty("expiresAt", exp); arr.add(o);
          }
        }
      }
      sendJson(ex, 200, GSON.toJson(arr));
    } catch (Exception e) { try { sendJson(ex, 500, "{\"error\":\"server\"}"); } catch (IOException ig) {} }
    finally { ex.close(); }
  }
  static void handleResetPassword(HttpExchange ex) throws IOException {
    try {
      secHeaders(ex);
      if (!ex.getRequestMethod().equals("POST")) { sendJson(ex, 405, "{\"error\":\"method\"}"); return; }
      String id = currentUserId(ex); if (id == null) { sendJson(ex, 401, "{\"error\":\"auth\"}"); return; }
      byte[] raw = readLimited(ex.getRequestBody(), 64 * 1024); if (raw == null) { sendJson(ex, 413, "{\"error\":\"too_large\"}"); return; }
      JsonObject b = JsonParser.parseString(new String(raw, StandardCharsets.UTF_8)).getAsJsonObject();
      String target = str(b, "userId");
      String otp;
      synchronized (DBLOCK) {
        Map<String,JsonObject> all = loadUsers(db());
        JsonObject me = all.get(id), t = all.get(target);
        if (me == null || roleLevel(str(me, "rol")) < 4) { sendJson(ex, 403, "{\"error\":\"forbidden\"}"); return; }
        if (t == null) { sendJson(ex, 404, "{\"error\":\"not_found\"}"); return; }
        otp = genOtp();
        exec(db(), "UPDATE users SET otp=?, pass=NULL, must_set_password=true WHERE id=?", otp, target);
        bumpRev();
      }
      sendJson(ex, 200, "{\"otp\":\"" + esc(otp) + "\"}");
      broadcast("{\"v\":" + getRev() + ",\"cid\":\"\"}");
    } catch (Exception e) { try { sendJson(ex, 400, "{\"error\":\"bad_request\"}"); } catch (IOException ig) {} }
    finally { ex.close(); }
  }
  static void handleReset(HttpExchange ex) throws IOException {
    try {
      secHeaders(ex);
      if (!ex.getRequestMethod().equals("POST")) { sendJson(ex, 405, "{\"error\":\"method\"}"); return; }
      String id = currentUserId(ex); if (id == null) { sendJson(ex, 401, "{\"error\":\"auth\"}"); return; }
      synchronized (DBLOCK) {
        JsonObject me = loadUsers(db()).get(id);
        if (me == null || !"admin".equals(str(me, "rol"))) { sendJson(ex, 403, "{\"error\":\"forbidden\"}"); return; }
        Connection c = db();
        for (String t : new String[]{"hubs","task_catalog","users","shifts","task_offers","backups","callouts","logs","plannings","schade","kwaliteit","lc","trolley","trolley_stock","diensten","invite_codes","meta"})
          try (Statement s = c.createStatement()) { s.execute("DELETE FROM " + t); }
      }
      clearSessionCookie(ex);
      sendJson(ex, 200, "{\"ok\":true}");
    } catch (Exception e) { try { sendJson(ex, 500, "{\"error\":\"server\"}"); } catch (IOException ig) {} }
    finally { ex.close(); }
  }
  static final String CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  static String genOtp() { StringBuilder s = new StringBuilder(); for (int i = 0; i < 6; i++) s.append(CODE_ALPHABET.charAt(RNG.nextInt(CODE_ALPHABET.length()))); return s.toString(); }
  static String genCode() { String s = genOtp() + genOtp(); return s.substring(0, 4) + "-" + s.substring(4, 8); }
  static String clientIp(HttpExchange ex) {
    List<String> xff = ex.getRequestHeaders().get("X-Forwarded-For");
    if (xff != null && !xff.isEmpty()) return xff.get(0).split(",")[0].trim();
    return ex.getRemoteAddress() != null ? ex.getRemoteAddress().getAddress().getHostAddress() : "?";
  }
  static boolean loginLocked(String ip) {
    long[] f = loginFails.get(ip);
    if (f == null) return false;
    if (System.currentTimeMillis() - f[1] > 15 * 60 * 1000) { loginFails.remove(ip); return false; } // venster 15 min
    return f[0] >= 10;
  }
  static void loginFail(String ip) {
    loginFails.compute(ip, (k, v) -> {
      long now = System.currentTimeMillis();
      if (v == null || now - v[1] > 15 * 60 * 1000) return new long[]{1, now};
      return new long[]{v[0] + 1, v[1]};
    });
  }
  static void loginOk(String ip) { loginFails.remove(ip); }
  static void sendJson(HttpExchange ex, int code, String body) throws IOException { byte[] b = body.getBytes(StandardCharsets.UTF_8); ex.getResponseHeaders().set("Content-Type", "application/json; charset=utf-8"); ex.sendResponseHeaders(code, b.length); ex.getResponseBody().write(b); }
  static String query(HttpExchange ex, String key) { String q = ex.getRequestURI().getQuery(); if (q == null) return null; for (String kv : q.split("&")) { String[] p = kv.split("=", 2); if (p[0].equals(key)) return p.length > 1 ? p[1] : ""; } return null; }
  static String esc(String s) { return s.replace("\\", "\\\\").replace("\"", "\\\""); }
  static String env(String k, String def) { String v = System.getenv(k); return (v != null && !v.isEmpty()) ? v : def; }
  // Constant-time string-vergelijking (tegen timing-aanvallen op de toegangspoort).
  static boolean constEq(String a, String b) {
    if (a == null || b == null) return false;
    byte[] x = a.getBytes(StandardCharsets.UTF_8), y = b.getBytes(StandardCharsets.UTF_8);
    return java.security.MessageDigest.isEqual(x, y);
  }
}
