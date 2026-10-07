# TC Play para Samsung Tizen

Proyecto independiente en `AlbertLanda/tc-play-samsung`. El código de la app está en la raíz de este repositorio. Consume las API existentes de Telecable; el backend, Android y LG se mantienen en sus proyectos correspondientes.

## Funciones incluidas

- Login con la API existente, categorías y canales.
- Navegación con flechas, OK, Return (10009), CH+ y CH−.
- Catálogo paginado de 12 canales para reducir nodos en televisores con pocos recursos.
- Reproducción HLS (`m3u8`) con Samsung AVPlay: preparación asíncrona, miniatura y pantalla completa; coordenadas convertidas al plano de 1920×1080.
- URL directa de Xtream: no llama a `proxy-url`, `stop-proxy` ni FFmpeg.
- Cancelación de respuestas y callbacks nativos antiguos al cambiar canal/categoría y al cerrar sesión.
- Límite de espera para inicio/buffering, reintento manual y liberación del reproductor al ocultar/salir de la app.
- Credenciales únicamente en memoria; no se guardan en localStorage ni en archivos. Se requiere login al reiniciar la app.

## Clonar una copia independiente

Si ya tienes una carpeta `tc-play-samsung` creada mediante worktree del repositorio Android, conserva esa carpeta y clona este repositorio en otra ruta. No cambies el remoto del worktree, porque esa configuración se comparte con el repositorio original.

```powershell
Set-Location C:\Users\aalrp\Proyectos
git clone https://github.com/AlbertLanda/tc-play-samsung.git tc-play-samsung-app
Set-Location tc-play-samsung-app
```

## Preparar en Windows

Requiere Node.js 18 o posterior. Desde PowerShell:

```powershell
Set-Location C:\Users\aalrp\Proyectos\tc-play-samsung-app
npm ci
Copy-Item config.example.json config.local.json
```

Edita `config.local.json` y coloca la URL del backend de pruebas aprobado en `apiBaseUrl`, sin `/api/xtream/`. Por ejemplo, `https://tu-backend-de-pruebas`. No pongas usuario ni contraseña en este archivo. Su valor inicial vacío evita conectar automáticamente con el servidor usado por clientes. No sobrescribas este archivo si ya está configurado.

```powershell
npm test
npm run build
npm start
```

La vista de desarrollo está en `http://localhost:4173`. Permite revisar interfaz y solicitudes; AVPlay se encuentra únicamente en el entorno Samsung. En navegador de PC la reproducción muestra un error porque no existe ese API. `npm run build` prepara `dist/`; no firma ni genera todavía el WGT.

## Empaquetar para el televisor

Instala Tizen Studio, la extensión Samsung TV y crea un certificado de desarrollo para el dispositivo. El SDK debe estar en PATH. Desde la raíz del proyecto:

```powershell
tizen build-web -- dist
tizen package -t wgt -s TU_PERFIL_DE_CERTIFICADO -- dist/.buildResult
```

Sustituye `TU_PERFIL_DE_CERTIFICADO` por el perfil creado en Certificate Manager. Si el SDK requiere metadata de proyecto, crea un Basic Project con perfil Samsung TV en Tizen Studio y copia el contenido de `dist/` al proyecto conservando `.project` y `.tproject` del SDK. La biblioteca AVPlay se carga desde `$WEBAPIS/webapis/webapis.js` del televisor.

El manifiesto contiene identificadores de prueba (`TcPlayTV01.TCPlay`) y `required_version=2.3`, como punto de partida de desarrollo; **no demuestra funcionamiento en todas las versiones desde 2.3**. Revisar los identificadores al registrar la app. La política de red permite los hosts de origen variables de Xtream para la prueba; antes de distribución debe ajustarse a los dominios reales y revisarse CSP y demás requisitos de tienda.

## Diagnosticar tamaño y cortes de reproducción

En el emulador del usuario, AVPlay acepta un rectángulo de 771×434 y sigue recortando el video. El registro solo muestra buffering inicial; esto no demuestra que red o stream estén libres de problemas. Para comparar otro motor con la misma URL directa de Xtream, prepara una compilación explícita de prueba:

```powershell
npm run build -- --player-engine=html5
```

Vuelve a ejecutar `dist` en el emulador. Este modo usa el `<video>` de Samsung con `object-fit: contain` y dimensiones explícitas para encajar la imagen completa. No usa AVPlay, un proxy ni una conversión. La reproducción HLS mediante `<video>` depende del entorno/stream: si no lo admite, fallará y el diagnóstico mostrará el error, sin cambiar de motor automáticamente. Se puede comparar el recorte y los cortes de reproducción entre ambos motores; una mejora no prueba por sí sola la causa del fallo anterior.

Para regresar a AVPlay, usa `npm run build -- --player-engine=avplay`. El parámetro solo afecta a la compilación en `dist`; no sobrescribe `config.local.json`. Sin parámetro, se utiliza `playerEngine` de ese archivo si existe, o `avplay` por defecto. Esta opción de prueba aún necesita validación en emulador y TV real.

La vista previa mantiene 16:9. El objeto nativo se coloca directamente en `body`, con coordenadas de pantalla y fuera del contenedor posicionado del recuadro, siguiendo el patrón del ejemplo de Samsung. El objeto y el plano AVPlay se ajustan al interior del recuadro, excluyendo su borde. Se aplica letterbox antes y después de la preparación y al alternar pantalla completa; este cambio no vuelve a abrir el stream. Una señal 4:3 puede mostrar barras laterales. El ajuste de la superficie nativa aún requiere verificar que elimina el recorte observado en el emulador.

Si un canal se congela o repite audio, deja reproducir entre 30 y 60 segundos y ejecuta en la consola del Web Inspector:

```js
console.log(JSON.stringify(TCPlayPlatform.getPlaybackDiagnostics(), null, 2));
```

El resultado incluye estado, viewport, rectángulo CSS real del objeto, rectángulo solicitado a AVPlay y último rectángulo aceptado, tiempo de reproducción, tiempo desde el último avance, conteo/duración de buffering y los últimos 30 eventos. Registra códigos de error conocidos; no incluye URL del stream, credenciales ni mensajes nativos completos. El diagnóstico se reinicia al elegir/reintentar un canal y no genera sondeos ni logs por cada tick. Los ticks recibidos durante buffering no lo dan por terminado.

En HTML5, el diagnóstico indica `renderer: html5-contain`, dimensiones del video de origen, estado del medio, milisegundos de buffer por delante y contadores de frames totales/descartados cuando el motor los ofrece. El evento `stalled` registra demora al obtener datos y no declara buffering mientras todavía puede avanzar el video. Solo `playing` da por terminada la espera iniciada por `waiting`.

Compara vista previa y pantalla completa, y prueba otro canal. Para descartar sesiones antiguas de depuración, reinicia el emulador y usa Run Project. Si continúa, compara el mismo canal en otro reproductor, deteniendo primero la reproducción en el emulador para no abrir conexiones simultáneas de la cuenta. El diagnóstico ayuda a distinguir buffering de problemas de renderizado/decodificación; el avance del reloj no prueba que audio y video estén bien. La fluidez y compatibilidad final deben comprobarse en un televisor real.

## Compatibilidad y validación pendiente

El código que corre en TV tiene sintaxis ES5 y no requiere React, módulos ES, fetch, Promise ni Media Source Extensions. La familia objetivo es Samsung Tizen; no incluye televisores anteriores con plataforma Orsay.

Se necesita medir en televisores antiguos y recientes: teclado virtual, foco, Return, canales, audio/video, buffering, retorno desde Home, tamaño del plano de video y salida. Probar HLS real de Xtream y acceso directo desde la red del cliente; redirecciones, TLS, codecs y características del manifiesto pueden variar por modelo. No se convierte un stream incompatible a través de proxy: se muestra un error y permite reintentar.

Las pruebas automatizadas verifican API simulada, carreras de solicitudes, navegación de la interfaz en jsdom y AVPlay simulado. No hubo conexión a Xtream, ejecución en SDK/TV real ni generación/firma de WGT en este entorno. No es una entrega lista para tienda. Favoritos, EPG, VOD, sesión persistente y mejoras finales de diseño quedan para siguientes entregas.

## Referencias oficiales

- [Crear apps para Samsung TV](https://developer.samsung.com/smarttv/develop/getting-started/creating-tv-applications.html)
- [AVPlay](https://developer.samsung.com/smarttv/develop/guides/multimedia/media-playback/using-avplay.html)
- [Control remoto](https://developer.samsung.com/smarttv/develop/guides/user-interaction/remote-control.html)
- [CLI y firma WGT](https://developer.samsung.com/smarttv/develop/getting-started/using-sdk/command-line-interface.html)
- [Manifiesto y permisos](https://developer.samsung.com/smarttv/develop/guides/fundamentals/configuring-tv-applications.html)
