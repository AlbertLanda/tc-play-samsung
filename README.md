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

En HTML5, el diagnóstico indica `renderer: html5-contain`, dimensiones del video de origen, estado del medio, milisegundos de buffer por delante y contadores de frames totales/descartados cuando el motor los ofrece. Si no hay rangos de buffer expuestos, `bufferedAheadMs` es `null`; si los frames totales permanecen en cero, `frameQuality` es `null`. Esas métricas ausentes no prueban falta de datos ni ausencia de cortes. El evento `stalled` registra demora al obtener datos y no declara buffering mientras todavía puede avanzar el video. Solo `playing` da por terminada la espera iniciada por `waiting`.

### Prueba local sin Xtream ni conexión

Si los dos motores presentan cortes, compara con el clip sintético incluido (20 s, H.264 Baseline 720×480 a 30 fps, AAC mono 48 kHz, cuadro en movimiento, contador de frames y tono continuo). No contiene contenido de canales ni credenciales.

```powershell
npm run build -- --playback-test
```

Ejecuta `dist` con **Run Project**, sin Inspector, y presiona **Iniciar / repetir**. Esta compilación abre una página aislada: no carga la app, el login, los adaptadores AVPlay/HTML5 del catálogo ni las API. Observa el movimiento y escucha el tono; los contadores del navegador no bastan para afirmar que es fluido. Al terminar, **Mostrar diagnóstico** incluye el tiempo de inicio y eventos. En Debug Project también puedes ejecutar `getLocalPlaybackTestDiagnostics()`.

Si el clip local también se corta, revisa emulador/host/decodificación: el contenido de Xtream y la red quedan fuera de esa prueba. Si el clip es fluido, todavía hay que comprobar el HLS real, su codificación y la conexión. El clip simple no certifica todos los codecs ni la reproducción en TV física. Puedes abrir `dist/playback-test.html` en el navegador del PC para comparar el mismo archivo fuera del emulador.

Regresa al catálogo con `npm run build -- --player-engine=html5` y vuelve a ejecutar `dist`. El modo de prueba solo reemplaza el punto de entrada en la compilación, sin modificar el proyecto original ni la configuración local.

Para regenerar el clip, los desarrolladores pueden ejecutar `node scripts/generate-playback-test.cjs` con FFmpeg instalado. El usuario que instala/prueba la app no necesita FFmpeg.

El usuario confirmó que el clip local se reproduce fluido en su emulador, mientras los canales HLS siguen presentando cortes. Como siguiente comparación, el backend existente acepta `output: ts` en `live/stream-url`: la app puede solicitar esa salida directa sin cambiar el backend ni convertir el video.

```powershell
npm run build -- --player-engine=html5 --stream-format=ts
```

Ejecuta `dist` con **Run Project** y observa el mismo canal entre 30 y 60 segundos, en vista previa y pantalla completa. Mantén un solo reproductor conectado a la cuenta. La compilación imprime `Salida directa de Xtream: ts`. La opción solo cambia el `output` enviado al backend; conserva la URL recibida exactamente y no cambia automáticamente de formato/motor si falla. TS es un contenedor admitido por Samsung, pero eso no garantiza que este stream en vivo funcione en el motor HTML5 del emulador. Si aparece un error, registra ese resultado: no significa por sí solo que el servidor esté averiado.

Para comparar de nuevo HLS, utiliza `npm run build -- --player-engine=html5 --stream-format=m3u8`. Los parámetros no escriben en `config.local.json`. Sin parámetro, `streamFormat` utiliza el valor del archivo local o `m3u8` por defecto. TS fluido frente a HLS entrecortado orientaría hacia diferencias entre ambas salidas o su reproducción; no identificaría por sí solo la causa ni garantiza inicio instantáneo.

### Comparar el canal real sin red

El usuario confirmó que HTML5/TS también presenta cortes en el emulador. Android volvió a reproducir al liberar la conexión simultánea y no presenta esos hipos. Esto orienta la investigación hacia el entorno Samsung/emulador y su recepción del directo, sin identificar todavía la causa.

Para conservar la codificación real del canal y separar recepción en vivo de reproducción local, cierra TC Play en Android y apaga el emulador. Si acabas de cerrar un directo, espera a que el proveedor libere la sesión. Desde la raíz del proyecto:

```powershell
git pull --ff-only
npm run capture-test
```

Introduce usuario y contraseña únicamente en tu terminal. La contraseña no se muestra; se mantienen en memoria para consultar el catálogo y pedir la URL TS al endpoint existente. Pulsa Enter para buscar WILLAX o escribe otro nombre, y selecciona el número si aparecen varias coincidencias. No pongas credenciales ni URLs privadas en comandos, capturas o mensajes.

El comando abre una sola conexión directa a Xtream, copia hasta 30 segundos o 50 MB de bytes TS sin convertir video/audio y cierra la conexión al terminar. No requiere FFmpeg. Guarda solo el fragmento en `.diagnostics/channel.ts`, carpeta excluida de Git. La duración del contenido puede diferir de 30 segundos por la entrega del servidor; la captura no incluye una prueba de codecs/continuidad. Un error de captura no elimina una captura anterior. Ctrl+C cancela la descarga y descarta el parcial.

```powershell
npm run build -- --playback-test=channel
```

Enciende el emulador y ejecuta `dist` con **Run Project**, sin Inspector. Pulsa **Iniciar / repetir**, compara tamaño pequeño/grande y observa si reaparece el hipo. Esta página reproduce el archivo incluido: no usa API, login ni red. **Mostrar diagnóstico** identifica `source: captured-ts`. Si el TS local no abre, registra el error: no prueba por sí solo que la señal esté dañada.

Compara también el mismo `.diagnostics/channel.ts` en un reproductor de PC que admita TS, si ya dispones de uno. Si el mismo archivo se corta solo en el emulador, eso orienta hacia su motor/host/compatibilidad. Si el archivo va fluido allí y el directo se corta, orienta hacia diferencias del flujo en vivo, su recepción o temporización. Si el archivo se corta también en PC, aún hay que distinguir problemas de la señal de los introducidos durante la captura. Ignora un posible corte al final del fragmento: la descarga se detiene sin esperar el final natural del canal.

Regresa al catálogo con `npm run build -- --player-engine=html5 --stream-format=ts`. Una compilación normal no incluye el fragmento capturado. La validación en una TV Samsung física continúa pendiente antes de distribuir.

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
