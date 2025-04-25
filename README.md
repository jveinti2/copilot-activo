# Servidor Audiohook Simplificado

Este proyecto es una implementación simplificada de un servidor Audiohook para Genesys Cloud. Se ha simplificado para eliminar dependencias de AWS y enfocarse en recibir el audio sin almacenamiento.

## Requisitos

- Node.js 16 o superior
- npm

## Instalación local

```bash
# Instalar dependencias
npm install

# Compilar el proyecto
npm run build

# Iniciar el servidor
npm start
```

El servidor se iniciará en http://localhost:8001 por defecto.

## Configuración Manual en EC2

1. **Preparar instancia EC2:**

   - Lanzar una instancia EC2 con Amazon Linux 2
   - Configurar grupo de seguridad para abrir el puerto 8001

2. **Instalar Node.js:**

   ```bash
   curl -sL https://rpm.nodesource.com/setup_16.x | sudo bash -
   sudo yum install -y nodejs
   ```

3. **Subir el código y ejecutar:**

   ```bash
   # En la instancia EC2
   mkdir -p audiohook-server
   cd audiohook-server

   # Subir archivos (desde tu máquina local)
   scp -r ./* ec2-user@tu-ip-ec2:~/audiohook-server/

   # En la instancia EC2
   cd ~/audiohook-server
   npm install
   npm run build

   # Ejecutar el servidor
   node dist/src/index.js
   ```

4. **Mantener el servidor ejecutándose (opcional):**

   ```bash
   # Instalar PM2
   npm install -g pm2

   # Iniciar con PM2
   pm2 start dist/src/index.js --name audiohook
   pm2 save
   pm2 startup
   ```

## Variables de Entorno

Crear un archivo `.env` en la raíz del proyecto con las siguientes variables:

```
NODE_ENV=development  # o production
SERVERPORT=8001
SERVERHOST=0.0.0.0
LOG_ROOT_DIR=./logs
```

## Pruebas

Para probar el servidor, puedes usar una herramienta como `wscat`:

```bash
npm install -g wscat
wscat -c "ws://localhost:8001/api/v1/audiohook/ws" -H "audiohook-session-id:12345678-1234-1234-1234-123456789012"
```

## Monitoreo

Para verificar que el servidor está en funcionamiento, comprueba el endpoint de salud:

```bash
curl http://localhost:8001/health/check
```
