import { promises as fs } from 'fs';
import path from 'path';

const TASKS_DB = path.join(process.cwd(), 'data', 'supervisor-tasks.json');

export class TaskTracker {
  constructor() {
    this.tasks = [];
    this.load();
  }

  async load() {
    try {
      const content = await fs.readFile(TASKS_DB, 'utf8');
      this.tasks = JSON.parse(content);
    } catch (e) {
      this.tasks = [];
      await this.save();
    }
  }

  async save() {
    await fs.mkdir(path.dirname(TASKS_DB), { recursive: true });
    await fs.writeFile(TASKS_DB, JSON.stringify(this.tasks, null, 2));
  }

  async createTask(task) {
    const newTask = {
      id: Date.now().toString(),
      createdAt: new Date().toISOString(),
      status: 'pending',
      ...task
    };
    
    this.tasks.push(newTask);
    await this.save();
    return newTask;
  }

  async updateTask(id, updates) {
    const index = this.tasks.findIndex(t => t.id === id);
    if (index !== -1) {
      this.tasks[index] = {
        ...this.tasks[index],
        ...updates,
        updatedAt: new Date().toISOString()
      };
      await this.save();
      return this.tasks[index];
    }
    return null;
  }

  async getTasks(filters = {}) {
    let filtered = [...this.tasks];
    
    if (filters.cliente) {
      filtered = filtered.filter(t => t.cliente === filters.cliente);
    }
    if (filters.estado) {
      filtered = filtered.filter(t => t.status === filters.estado);
    }
    if (filters.prioridad) {
      filtered = filtered.filter(t => t.prioridad === filters.prioridad);
    }
    
    return filtered.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  }

  async getTask(id) {
    return this.tasks.find(t => t.id === id);
  }

  async getStats() {
    const stats = {
      total: this.tasks.length,
      pendientes: this.tasks.filter(t => t.status === 'pending').length,
      en_progreso: this.tasks.filter(t => t.status === 'in_progress').length,
      completadas: this.tasks.filter(t => t.status === 'completed').length,
      fallidas: this.tasks.filter(t => t.status === 'failed').length,
      por_cliente: {}
    };

    this.tasks.forEach(t => {
      if (!stats.por_cliente[t.cliente]) {
        stats.por_cliente[t.cliente] = { total: 0, completed: 0 };
      }
      stats.por_cliente[t.cliente].total++;
      if (t.status === 'completed') {
        stats.por_cliente[t.cliente].completed++;
      }
    });

    return stats;
  }

  // Formato para supervisor
  formatForSupervisor(tasks) {
    return tasks.map(t => ({
      id: t.id,
      cliente: t.cliente,
      requerimiento: t.requerimiento,
      estado: t.status,
      prioridad: t.prioridad,
      cambio_url: t.cambio_url,
      commit: t.commit,
      creado: t.createdAt,
      actualizado: t.updatedAt
    }));
  }
}
