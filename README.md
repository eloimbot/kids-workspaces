# Kids Workspaces

Plataforma estilo Kasm Workspaces, pero mas simple de operar y pensada para ejecutar apps y navegadores dentro de contenedores Docker usando imagenes de `linuxserver.io`.

## Idea del producto

La app expone un panel web donde puedes:

- iniciar sesion con usuarios y roles;
- ver catalogo de apps disponibles;
- lanzar una sesion en un contenedor Docker;
- lanzar varias sesiones simultaneas, incluso de la misma app;
- abrir la URL de la app en el navegador;
- detener sesiones creadas desde el panel.

Ahora las sesiones se publican por rutas internas como `/workspaces/kids-firefox-ab12cd/`, lo que permite usar un solo dominio y un solo Cloudflare Tunnel sin exponer puertos dinamicos.

## Arquitectura

- `backend/`: API HTTP con Express y proxy reverse para workspaces.
- `frontend/public/`: interfaz web estatica servida por el backend.
- `backend/data/templates.json`: catalogo de apps basadas en `lscr.io/linuxserver/*`.
- `backend/data/users.json`: usuarios locales iniciales.

Flujo basico:

1. El frontend pide el catalogo a la API.
2. El usuario inicia sesion y obtiene una sesion web.
3. El usuario elige una app, por ejemplo Firefox o Webtop.
4. El backend ejecuta `docker run` con labels de ownership y deja que Docker asigne un puerto libre automaticamente.
5. El backend publica la sesion en `/workspaces/<nombre>/`.
6. Cloudflare Tunnel expone solo el panel principal y el proxy redirige al contenedor correcto.

Importante sobre puertos:

- el panel principal puede vivir en `3000` sin chocar con contenedores que tambien usan `3000` internamente;
- cada contenedor publica su puerto interno en un puerto host aleatorio `127.0.0.1`;
- ademas ahora cada plantilla guarda `containerPort` y `protocol` para soportar casos como `code-server` en `8443/https`.

## Sesiones simultaneas

El proyecto ahora esta preparado para varias sesiones al mismo tiempo:

- cada sesion recibe un nombre unico;
- Docker asigna un puerto libre automaticamente, evitando choques por concurrencia;
- puedes lanzar varias sesiones de la misma plantilla sin reemplazar las anteriores;
- cada sesion tiene su propia ruta proxificada bajo `/workspaces/<nombre>/`;
- cada sesion queda asociada a un propietario.

## Usuarios y roles

Hay autenticacion local con sesion HTTP y dos roles:

- `admin`: ve todas las sesiones y puede crear usuarios.
- `manager`: solo ve y controla sus propias sesiones.

Usuarios demo iniciales:

- `admin@kidsworkspaces.local` / `admin123`
- `manager@kidsworkspaces.local` / `manager123`

## Apps de ejemplo

- `firefox`
- `chromium`
- `webtop-ubuntu-kde`
- `code-server`

## Requisitos

- Node.js 20+
- Docker instalado y accesible desde `docker`

## Arranque local

```bash
cd backend
npm.cmd install
npm run dev
```

Luego abre:

```text
http://localhost:3000
```

## Variables utiles

- `PORT`: puerto del panel.
- `APP_HOST`: host usado para URLs locales directas. Por defecto `localhost`.
- `SESSION_PROXY_HOST`: host al que el backend proxya las sesiones. En Linux con Docker suele ser `host.docker.internal`.
- `PUBLIC_BASE_URL`: URL publica del panel, por ejemplo `https://workspaces.midominio.com`.
- `NODE_ENV=production`: activa cookies `Secure`.

## Endpoints principales

- `POST /api/auth/login`
- `POST /api/auth/logout`
- `GET /api/auth/me`
- `GET /api/health`
- `GET /api/templates`
- `POST /api/templates`
- `GET /api/sessions`
- `POST /api/sessions`
- `DELETE /api/sessions/:name`
- `GET /api/users`
- `POST /api/users`
- `GET /workspaces/:name/*`

## Catalogo linuxserver.io

Los administradores pueden anadir nuevas plantillas desde la interfaz:

- abre `Add linuxserver image`;
- registra una imagen `lscr.io/linuxserver/...`;
- define nombre, categoria, puerto, ruta y thumbnail opcional;
- la plantilla queda disponible inmediatamente para los usuarios.

Nota:
La tienda actual es curada, no un espejo automatico de todo el catalogo oficial de LinuxServer.io. Ya incluye apps como `Vivaldi`, pero si quieres puedo hacer el siguiente paso para sincronizar muchas mas o permitir importacion libre desde cualquier imagen `lscr.io/linuxserver/*`.

## Vista para usuario normal

Los usuarios `manager` ven una experiencia mas cercana a Kasm:

- solo aparece el catalogo de workspaces;
- al lado ven sus sesiones activas;
- no ven gestion de usuarios ni herramientas administrativas.

## Despliegue en Linux con Cloudflare Tunnel

1. Crea un tunnel en Cloudflare Zero Trust.
2. Asocia un hostname, por ejemplo `workspaces.midominio.com`.
3. Pon ese dominio en `PUBLIC_BASE_URL` dentro de `docker-compose.linux.yml`.
4. Exporta el token del tunnel:

```bash
export TUNNEL_TOKEN=tu_token
```

5. Arranca el stack:

```bash
docker compose -f docker-compose.linux.yml up -d --build
```

6. Abre:

```text
https://workspaces.midominio.com
```

Detalles importantes:

- El servicio principal monta `/var/run/docker.sock` para crear y parar contenedores.
- `host.docker.internal:host-gateway` permite que el proxy dentro del contenedor llegue a los puertos publicados en el host Linux.
- Cloudflare solo necesita publicar el panel en el puerto `3000`; las sesiones viajan por rutas internas del mismo dominio.

## Siguiente paso recomendado

Para acercarnos mas a Kasm, lo siguiente seria agregar:

- autenticacion y usuarios;
- perfiles persistentes por app;
- proxy reverso con subdominios o rutas;
- expiracion automatica de sesiones;
- limites de CPU y RAM;
- auditoria y permisos por catalogo.
