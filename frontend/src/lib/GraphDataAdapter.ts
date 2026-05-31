import { GraphPayload } from "../types/osint.types";

export const adaptGraphResponse = (rawResponse: any): GraphPayload => {
  // Gelen veriyi grafiğin anlayacağı kesin tipe çevirir (Güvenlik önlemi)
  return {
    nodes: Array.isArray(rawResponse?.nodes) ? rawResponse.nodes : [],
    links: Array.isArray(rawResponse?.links) ? rawResponse.links : []
  };
};
