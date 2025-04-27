import { FastifyInstance } from "fastify";

// Almacena todas las conexiones WebSocket activas
const activeConnections: Set<any> = new Set();

// Registra la ruta WebSocket para los clientes
export const addWebSocketRoute = (
  fastify: FastifyInstance,
  path: string
): void => {
  fastify.get(path, { websocket: true }, (connection, request) => {
    request.log.info(`Nueva conexión WebSocket: ${request.url}`);

    // Agregar la conexión al conjunto de conexiones activas
    activeConnections.add(connection.socket);

    // Limpieza cuando se cierra la conexión
    connection.socket.on("close", () => {
      request.log.info(`Conexión WebSocket cerrada: ${request.url}`);
      activeConnections.delete(connection.socket);
    });
  });
};

// Función para enviar mensajes a todos los clientes conectados
export const broadcastMessage = (message: any): void => {
  const messageString = JSON.stringify(message);

  activeConnections.forEach((socket) => {
    if (socket.readyState === 1) {
      // WebSocket.OPEN
      socket.send(messageString);
    }
  });

  console.log(`📢 Mensaje enviado a ${activeConnections.size} clientes`);
};
