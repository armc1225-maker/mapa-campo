# Prompts para Google AI Studio (Build → Android) — Mapa de Campo

App propia de mapas sin internet. Pegue el **Prompt 1** al crear la app. Cuando funcione en el teléfono, pegue el **Prompt 2** en el mismo proyecto.

---

## Prompt 1 — Mapas georreferenciados, GPS, puntos, tracks y áreas

```
Crea una app Android nativa (Kotlin + Jetpack Compose, Material 3, una sola Activity, sin servidor, sin cuentas, todo en español) llamada "Mapa de Campo" para usar mapas en el campo sin internet, en Guatemala (técnicos forestales).

1. BIBLIOTECA DE MAPAS
  - Pantalla inicial con la lista de mapas importados: miniatura, nombre, fecha, número de elementos y una etiqueta "Georreferenciado" o "Sin georreferencia".
  - Botón "Importar mapa" que abre el selector de archivos del sistema (Storage Access Framework) para PDF, JPG y PNG. También debe aceptar PDF compartidos desde otras apps (intent-filter ACTION_VIEW y ACTION_SEND con application/pdf).
  - Si el PDF tiene varias páginas, pregunta cuál usar.
  - Mantener pulsado un mapa: cambiar nombre o eliminarlo con todos sus elementos y fotos (con confirmación).

2. LECTURA DE GEOPDF
  - Dibuja la página del PDF con android.graphics.pdf.PdfRenderer a una imagen grande (lado mayor 4096 px, máximo 16 millones de píxeles) y guárdala en el almacenamiento interno de la app. Muestra el mapa con zoom y desplazamiento fluidos (por ejemplo con la librería "subsampling-scale-image-view" o un visor de mosaicos propio), para que no se agote la memoria.
  - Lee la georreferencia del PDF según ISO 32000 (GeoPDF de QGIS, ArcGIS, Global Mapper): en el diccionario de la página, el arreglo /VP contiene diccionarios con /BBox [x1 y1 x2 y2] (en coordenadas de la página) y /Measure con /Subtype /GEO, /GPTS (pares latitud, longitud en grados) y /LPTS (pares x, y de 0 a 1 dentro del BBox). Usa el VP de mayor área.
  - Los objetos pueden estar en flujos de objetos comprimidos (/Type /ObjStm con /FlateDecode, PDF 1.5+): descomprímelos con java.util.zip.Inflater y búscalos ahí también. Resuelve referencias indirectas "n 0 R". Escribe un analizador mínimo de objetos PDF (diccionarios, arreglos, números, nombres, cadenas, referencias); no uses librerías de pago.
  - Convierte cada punto LPTS a coordenada de página y luego a píxel de la imagen (el origen del PDF está abajo a la izquierda; el de la imagen arriba a la izquierda; respeta /Rotate y el MediaBox/CropBox).
  - Con esos puntos de control calcula la transformación (ver punto 4). Si el PDF no tiene georreferencia, el mapa queda "Sin georreferencia" y se ofrece georreferenciarlo a mano.

3. COORDENADAS (WGS84)
  - Implementa la proyección Transversa de Mercator (directa e inversa, fórmulas de Snyder/USGS, elipsoide WGS84: a = 6378137, f = 1/298.257223563).
  - UTM: k0 = 0.9996, falso este 500000, falso norte 0 (10000000 en el sur), meridiano central = zona × 6 − 183.
  - GTM (Guatemala Transverse Mercator): meridiano central −90.5°, k0 = 0.9998, falso este 500000, falso norte 0, latitud de origen 0.
  - Formatos de visualización elegibles en Ajustes: grados decimales, grados-minutos-segundos (N/S, E/O), UTM y GTM.
  - Pruebas unitarias obligatorias: (lat 0, lon −87) → UTM zona 16, E = 500000.000, N = 0.000; (14, −90.5) → GTM X = 500000.000; ida y vuelta UTM y GTM con error < 1e-8°.

4. GEORREFERENCIA (píxel ↔ lat/lon)
  - Proyecta los puntos de control a una Transversa de Mercator local (meridiano central y latitud de origen = promedio de los puntos, k0 = 1) y ajusta por mínimos cuadrados una transformación afín de metros locales a píxeles: px = a·X + b·Y + c ; py = d·X + e·Y + f.
  - Con exactamente 2 puntos usa una transformación de semejanza con reflejo (px = a·X + b·Y + c ; py = b·X − a·Y + f).
  - Rechaza puntos alineados o repetidos con un mensaje claro. Calcula el desvío de cada punto en metros, el error medio (RMS) y los metros por píxel.
  - Georreferenciación manual: modo con una cruz en el centro de la pantalla; el usuario centra la cruz (o toca el mapa) sobre un punto conocido y escribe sus coordenadas en Lat/Lon, UTM (zona, E, N, hemisferio) o GTM (X, Y), o pulsa "Usar mi GPS". Muestra los puntos numerados en el mapa y la lista con su desvío; botón Guardar con 2 o más puntos. Acepta coma o punto decimal.

5. GPS
  - FusedLocationProviderClient, prioridad alta, intervalo 1 s. Pide el permiso de ubicación precisa con una explicación breve.
  - Punto azul con círculo de precisión. Barra superior con el nombre del mapa, la coordenada en el formato elegido, la precisión (±m) y la altitud. Avisa "señal débil" si la precisión es peor de 30 m y "Fuera del mapa (distancia)" si la posición está fuera de la imagen.
  - Botón "Ubicarme" que centra y sigue la posición; arrastrar el mapa desactiva el seguimiento.

6. ELEMENTOS (guardados en Room, en lat/lon WGS84, ligados al mapa)
  - Punto: en la posición GPS (guarda altitud, precisión y hora) o en la cruz del centro.
  - Línea (medir distancia) y Área (polígono): añadir vértices tocando el mapa, con la cruz o con el GPS; deshacer; mostrar en vivo la longitud o el área y el perímetro, incluyendo una línea punteada hasta la cruz. Mínimo 2 vértices para línea y 3 para área.
  - Track: grabación del recorrido con un servicio en primer plano (foreground service tipo location, con notificación) para que siga grabando con la pantalla apagada. Descarta lecturas con precisión peor de 50 m y puntos a menos de max(3 m, precisión/2) del anterior. Pausa, reanudar y detener; muestra tiempo, distancia y número de puntos. Guarda en la base de datos cada 15 s para no perder datos.
  - Editor de cada elemento: nombre (automático "Punto 1", "Área 2"…), nota, color (7 colores), fotos con la cámara (reducidas a 1600 px JPEG, guardadas en el almacenamiento interno), y datos: coordenadas en los 4 formatos, altitud, precisión, longitud, área, perímetro, vértices, duración y fecha. Botones Guardar, Eliminar (con confirmación) y Ver (acercar al elemento).
  - Mostrar u ocultar los nombres de los elementos sobre el mapa.

7. MEDIDAS
  - Distancias con la fórmula de haversine (radio 6371008.8 m).
  - Áreas: proyecta el polígono a una Transversa de Mercator local centrada en él y aplica la fórmula del área de Gauss. Muestra hectáreas (4 decimales), manzanas (1 mz = 6987.5 m², 3 decimales) y m².
  - Prueba unitaria: un cuadrado de unos 100 m × 100 m cerca de (14.6, −90.5) debe dar 1.00 ha ± 0.6 %.

DISEÑO
  - Uso en campo a pleno sol y con una mano: mapa a pantalla completa, barra inferior flotante con iconos y texto (Ubicarme, Punto, Track, Medir, Área, Elementos), botones grandes, alto contraste, tema claro y oscuro, acento verde bosque.
  - Mantén la pantalla encendida mientras se graba un track o se dibuja.
  - Todo funciona sin internet. No uses Google Maps ni mapas en línea.
```

---

## Prompt 2 — Exportación y lista de elementos

```
Agrega a "Mapa de Campo":

1. Pantalla "Elementos" del mapa: lista de puntos, tracks, líneas y áreas (el más reciente arriba) con color, nombre, tipo y resumen (coordenada, longitud o área en ha y mz, número de fotos). Tocar uno acerca el mapa y abre su editor.

2. Exportar todos los elementos del mapa y compartir el archivo con el menú Compartir de Android (FileProvider), o guardarlo con el selector de archivos:
   - KML 2.2: Placemark con nombre, descripción (nota, longitud, área, perímetro, precisión GPS), fecha, estilo con el color del elemento (formato aabbggrr; relleno de áreas semitransparente). Point, LineString (tessellate 1) y Polygon (anillo cerrado). Coordenadas lon,lat,alt con 7 decimales.
   - GPX 1.1: puntos como <wpt> con ele, time, name y desc; tracks, líneas y áreas como <trk> (las áreas cerradas, con <type>area</type>), cada punto del track con ele y time.
   - CSV (UTF-8 con BOM para Excel, separador coma): tipo, nombre, nota, latitud, longitud (el centroide en líneas y áreas), altitud_m, precision_m, gtm_x, gtm_y, utm_zona, utm_e, utm_n, fecha (ISO 8601), longitud_m, perimetro_m, area_m2, area_ha, area_mz, vertices, wkt (POINT, LINESTRING o POLYGON).
   - KMZ: el KML más las fotos de cada elemento dentro del ZIP, enlazadas en la descripción con <img>.
   - Escapa correctamente &, <, >, comillas y comas.

3. Importar KML o GPX (puntos, líneas y polígonos) a un mapa existente para ver límites de fincas o parcelas levantados con otro equipo.
```
