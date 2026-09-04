# Valor local

Dashboard para consultar el dólar BCV, euro BCV y dólar Binance en Venezuela usando [DolarApi](https://dolarapi.com/docs/venezuela/) y [ExchangeMonitor](https://exchangemonitor.net/venezuela/dolar-binance).

## Ejecutar localmente

Desde esta carpeta:

```bash
python3 server.py
```

Luego abre `http://localhost:4173`.

## Regla de fechas

- Viernes consulta la fecha actual.
- Sábado y domingo consultan la fecha del lunes siguiente para dólar y euro BCV.
- Si el lunes todavía no está publicado en la API, se mantiene visible el último valor BCV disponible y se marca como respaldo.
- Binance consulta ExchangeMonitor desde el proxy `/api/binance`, que devuelve el precio principal, compra y venta.
- El proxy prioriza la API oficial de ExchangeMonitor cuando existen credenciales, luego intenta la página pública y una lectura alternativa del mismo contenido.
- Si ExchangeMonitor no está disponible, consulta la cotización pública de Binance P2P para `USDT/VES`; la tarjeta lo etiqueta como `Binance P2P` porque ese monto puede diferir del promedio de ExchangeMonitor.
- Si ExchangeMonitor no responde, Binance usa DolarApi como respaldo y lo indica en pantalla.

La app refresca al cargar, con el botón `Actualizar` y automáticamente cada 10 minutos.

## Publicar en Vercel

El archivo `api/binance.js` expone el proxy de Binance como función serverless; Vercel detecta automáticamente los archivos dentro de `/api`.

### Configurar ExchangeMonitor en Vercel

Las funciones de Vercel pueden recibir una respuesta `403` de la página pública cuando se consultan desde una IP de nube. Para evitar depender de ese bloqueo, crea una cuenta o API key en ExchangeMonitor y añade una de estas opciones en **Project Settings → Environment Variables**:

```text
EXCHANGE_MONITOR_AUTH=app-id:api-key
```

o:

```text
EXCHANGE_MONITOR_APP_ID=app-id
EXCHANGE_MONITOR_API_KEY=api-key
```

Después selecciona `Production` (y `Preview` si también lo necesitas) y vuelve a desplegar. Las variables nuevas solo se aplican a despliegues nuevos. No pongas estas credenciales en `app.js`, `index.html` ni en variables `NEXT_PUBLIC_*`.

Mientras no haya credenciales, el proxy intenta la página pública y una ruta de lectura alternativa. Si ambas son bloqueadas o alcanzan su límite, usa Binance P2P público; si tampoco responde, el dashboard conserva el respaldo de DolarApi para que las cotizaciones oficiales sigan visibles.

## Favicon

`favicon.svg` contiene el ícono del dashboard y ya está enlazado desde `index.html`.
