import { toast as sonner } from "sonner";
import { buzzError, buzzSuccess } from "@/components/tg/webapp";

/**
 * sonner's toast, plus a success or error buzz inside Telegram. For screens
 * whose saves don't go through the Mini App's useAction (which buzzes itself):
 * v1's, and the Mini App's admin editors.
 */
export const toast = Object.assign((...args: Parameters<typeof sonner>) => sonner(...args), sonner, {
  success: (...args: Parameters<typeof sonner.success>) => {
    buzzSuccess();
    return sonner.success(...args);
  },
  error: (...args: Parameters<typeof sonner.error>) => {
    buzzError();
    return sonner.error(...args);
  },
});
