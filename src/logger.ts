import chalk from "chalk";

const PREFIX = "[VarManagerPlugin]";

export const log = (...args: unknown[]): void => {
  console.log(chalk.green(PREFIX), ...args);
};

export const warn = (...args: unknown[]): void => {
  console.warn(chalk.yellow(PREFIX), ...args);
};

export const error = (...args: unknown[]): void => {
  console.error(chalk.red(PREFIX), ...args);
};
