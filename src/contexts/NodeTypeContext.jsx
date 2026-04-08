import { createContext, useContext } from "react";
import { NODE_TYPE_CONFIG } from "../constants/nodeTypes.js";

export const NodeTypeContext = createContext(NODE_TYPE_CONFIG);
export const useNodeTypeConfig = () => useContext(NodeTypeContext);
