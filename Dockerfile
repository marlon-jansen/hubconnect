# HubConnect — Java-backend + statische app, klaar voor Render (gratis web service)
FROM eclipse-temurin:21-jdk

WORKDIR /app
COPY . /app

# Compileer de server bij de build (sneller opstarten, fouten vroeg zichtbaar)
RUN javac -cp "lib/postgresql.jar:lib/gson.jar" -d out Server.java

# Render geeft de poort door via $PORT; webroot is de map "web"
CMD ["sh", "-c", "java -cp out:lib/postgresql.jar:lib/gson.jar Server ${PORT:-8210} web"]
