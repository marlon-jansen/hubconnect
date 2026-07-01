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
  static Connection conn;
  static final Object DBLOCK = new Object(); // serialiseert alle DB-toegang (1 gedeelde verbinding)
  static final Gson GSON = new Gson();
  static final List<OutputStream> sseClients = new CopyOnWriteArrayList<>();

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
    // Toegangspoort (tijdelijke stopgap): gedeelde HTTP Basic-login vóór de hele app + API.
    GATE_USER = env("GATE_USER", p.getProperty("gate.user"));
    GATE_PASS = env("GATE_PASS", p.getProperty("gate.pass"));
    if (GATE_USER == null) GATE_USER = "hub";

    initDb();

    HttpServer server = HttpServer.create(new InetSocketAddress(port), 0);
    server.setExecutor(Executors.newCachedThreadPool());
    HttpContext cState   = server.createContext("/api/state", Server::handleState);
    HttpContext cVersion = server.createContext("/api/version", Server::handleVersion);
    HttpContext cEvents  = server.createContext("/api/events", Server::handleEvents);
    HttpContext cStatic  = server.createContext("/", ex -> handleStatic(ex, webroot));
    if (GATE_PASS != null && !GATE_PASS.isEmpty()) {
      Authenticator gate = new BasicAuthenticator("HubConnect") {
        public boolean checkCredentials(String user, String pass) {
          return constEq(user, GATE_USER) & constEq(pass, GATE_PASS);
        }
      };
      cState.setAuthenticator(gate); cVersion.setAuthenticator(gate);
      cEvents.setAuthenticator(gate); cStatic.setAuthenticator(gate);
      System.out.println("Toegangspoort AAN (gebruiker: " + GATE_USER + ").");
    } else {
      System.out.println("LET OP: toegangspoort UIT (geen GATE_PASS gezet) - API is publiek bereikbaar.");
    }
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
      "CREATE TABLE IF NOT EXISTS diensten (hub_id TEXT, datum TEXT, dagdeel TEXT, schadecontrole JSONB, lc JSONB, kwaliteit JSONB, PRIMARY KEY (hub_id, datum, dagdeel))"
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
        addNullable(o, "pass", r.getString("pass"));
        addNullable(o, "otp", r.getString("otp"));
        o.addProperty("mustSetPassword", r.getBoolean("must_set_password"));
        o.addProperty("rol", r.getString("rol"));
        o.addProperty("n2", r.getBoolean("n2"));
        o.addProperty("jbtTrainer", r.getBoolean("jbt_trainer"));
        o.addProperty("hubId", r.getString("hub_id"));
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
    root.add("kwaliteit", shiftMap(c, "kwaliteit", new String[]{"emballage","soort"}, new String[]{"{}","{}"}));
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
      while (r.next()) { JsonObject o = new JsonObject(); o.add("schadecontrole", parse(r.getString("schadecontrole"), "[]")); o.add("lc", parse(r.getString("lc"), "[]")); o.add("kwaliteit", parse(r.getString("kwaliteit"), "[]")); di.add(key(r), o); }
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
  static void saveState(String body) throws SQLException {
    JsonObject root = JsonParser.parseString(body).getAsJsonObject();
    Connection c = db();
    boolean prevAuto = c.getAutoCommit();
    c.setAutoCommit(false);
    try (Statement s = c.createStatement()) {
      for (String t : new String[]{"hubs","task_catalog","users","shifts","task_offers","backups","callouts","logs","plannings","schade","kwaliteit","lc","trolley","trolley_stock","diensten"}) s.execute("DELETE FROM " + t);

      // hubs
      for (JsonElement e : arr(root, "hubs")) { JsonObject o = e.getAsJsonObject(); exec(c, "INSERT INTO hubs (id,naam) VALUES (?,?)", o.get("id").getAsString(), str(o,"naam")); }
      // task_catalog + types
      JsonArray cat = arr(root, "taskCatalog"); JsonObject types = obj(root, "taskTypes");
      for (int i = 0; i < cat.size(); i++) { String naam = cat.get(i).getAsString(); String type = types.has(naam) ? types.get(naam).getAsString() : "bezorger"; exec(c, "INSERT INTO task_catalog (naam,type,ord) VALUES (?,?,?)", naam, type, i); }
      // users
      for (JsonElement e : arr(root, "users")) { JsonObject o = e.getAsJsonObject();
        exec(c, "INSERT INTO users (id,personeelsnummer,email,voornaam,achternaam,pass,otp,must_set_password,rol,n2,jbt_trainer,hub_id,taken,stats,hidden,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?::jsonb,?::jsonb,?,?)",
          str(o,"id"),str(o,"personeelsnummer"),str(o,"email"),str(o,"voornaam"),str(o,"achternaam"),str(o,"pass"),str(o,"otp"),bool(o,"mustSetPassword"),str(o,"rol"),bool(o,"n2"),bool(o,"jbtTrainer"),str(o,"hubId"),jraw(o,"taken","[]"),jraw(o,"stats","{}"),bool(o,"hidden"),str(o,"createdAt")); }
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
        exec(c, "INSERT INTO kwaliteit (hub_id,datum,dagdeel,emballage,soort) VALUES (?,?,?,?::jsonb,?::jsonb)", k[0],k[1],k[2],jraw(o,"emballage","{}"),jraw(o,"soort","{}")); }
      for (Map.Entry<String,JsonElement> en : obj(root,"lc").entrySet()) { String[] k = en.getKey().split("\\|",3); JsonObject o = en.getValue().getAsJsonObject();
        exec(c, "INSERT INTO lc (hub_id,datum,dagdeel,aantal,vakken) VALUES (?,?,?,?,?::jsonb)", k[0],k[1],k[2],intOf(o,"aantal"),jraw(o,"vakken","[]")); }
      for (Map.Entry<String,JsonElement> en : obj(root,"trolley").entrySet()) { String[] k = en.getKey().split("\\|",3); JsonObject o = en.getValue().getAsJsonObject();
        exec(c, "INSERT INTO trolley (hub_id,datum,dagdeel,stock4,stock5,pendels) VALUES (?,?,?,?,?,?::jsonb)", k[0],k[1],k[2],intOf(o,"stock4"),intOf(o,"stock5"),jraw(o,"pendels","[]")); }
      for (Map.Entry<String,JsonElement> en : obj(root,"trolleyStock").entrySet()) { String[] k = en.getKey().split("\\|",2); JsonObject o = en.getValue().getAsJsonObject();
        exec(c, "INSERT INTO trolley_stock (hub_id,datum,stock4,stock5) VALUES (?,?,?,?)", k[0], k[1], intOf(o,"stock4"), intOf(o,"stock5")); }
      for (Map.Entry<String,JsonElement> en : obj(root,"diensten").entrySet()) { String[] k = en.getKey().split("\\|",3); JsonObject o = en.getValue().getAsJsonObject();
        exec(c, "INSERT INTO diensten (hub_id,datum,dagdeel,schadecontrole,lc,kwaliteit) VALUES (?,?,?,?::jsonb,?::jsonb,?::jsonb)", k[0],k[1],k[2],jraw(o,"schadecontrole","[]"),jraw(o,"lc","[]"),jraw(o,"kwaliteit","[]")); }

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
      cors(ex);
      String m = ex.getRequestMethod();
      if (m.equals("OPTIONS")) { ex.sendResponseHeaders(204, -1); return; }
      if (m.equals("GET")) {
        String out;
        synchronized (DBLOCK) { out = hasUsers() ? ("{\"version\":" + getRev() + ",\"data\":" + buildState() + "}") : "{\"empty\":true,\"version\":0}"; }
        sendJson(ex, 200, out);
      } else if (m.equals("PUT")) {
        String cid = query(ex, "cid");
        String body = new String(ex.getRequestBody().readAllBytes(), StandardCharsets.UTF_8);
        long rev;
        synchronized (DBLOCK) { saveState(body); rev = bumpRev(); }
        broadcast("{\"v\":" + rev + ",\"cid\":\"" + (cid == null ? "" : esc(cid)) + "\"}");
        sendJson(ex, 200, "{\"version\":" + rev + "}");
      } else sendJson(ex, 405, "{\"error\":\"method\"}");
    } catch (Exception e) {
      e.printStackTrace();
      try { sendJson(ex, 500, "{\"error\":\"" + esc(String.valueOf(e.getMessage())) + "\"}"); } catch (IOException ignore) {}
    } finally { ex.close(); }
  }
  static void handleVersion(HttpExchange ex) throws IOException {
    try {
      cors(ex);
      if (ex.getRequestMethod().equals("OPTIONS")) { ex.sendResponseHeaders(204, -1); return; }
      long rev; synchronized (DBLOCK) { rev = getRev(); }
      sendJson(ex, 200, "{\"version\":" + rev + "}");
    } catch (Exception e) { try { sendJson(ex, 500, "{\"error\":\"version\"}"); } catch (IOException ignore) {} }
    finally { ex.close(); }
  }
  static void handleEvents(HttpExchange ex) throws IOException {
    cors(ex);
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
      if (!file.startsWith(webroot) || !Files.exists(file) || Files.isDirectory(file)) { sendJson(ex, 404, "{\"error\":\"not found\"}"); return; }
      byte[] bytes = Files.readAllBytes(file);
      ex.getResponseHeaders().set("Content-Type", contentType(file.toString()));
      ex.getResponseHeaders().set("Cache-Control", "no-cache");
      ex.sendResponseHeaders(200, bytes.length);
      ex.getResponseBody().write(bytes);
    } catch (Exception e) { try { sendJson(ex, 500, "{\"error\":\"static\"}"); } catch (IOException ignore) {} } finally { ex.close(); }
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
    if (f.endsWith(".svg")) return "image/svg+xml";
    if (f.endsWith(".png")) return "image/png";
    if (f.endsWith(".jpg") || f.endsWith(".jpeg")) return "image/jpeg";
    if (f.endsWith(".ico")) return "image/x-icon";
    return "application/octet-stream";
  }
  static void cors(HttpExchange ex) { Headers h = ex.getResponseHeaders(); h.set("Access-Control-Allow-Origin", "*"); h.set("Access-Control-Allow-Methods", "GET,PUT,OPTIONS"); h.set("Access-Control-Allow-Headers", "Content-Type"); }
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
