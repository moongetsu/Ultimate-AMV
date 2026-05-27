import React from "react";
import { render, screen } from "@testing-library/react";
import { BgRemovePanel } from "./BgRemovePanel";
import "../../../tests/setup/tauri";

describe("BgRemovePanel", () => {
  describe("Video Isolate Tab", () => {
    it("renders video panel header and instructions", () => {
      render(<BgRemovePanel activeTab="video" />);
      expect(screen.getByText("One-Click Video Background Removal")).toBeInTheDocument();
      expect(screen.getByText(/Isolate characters from video files/)).toBeInTheDocument();
    });

    it("renders options dropdowns in video mode", () => {
      render(<BgRemovePanel activeTab="video" />);
      expect(screen.getByLabelText("AI Segmentation Model")).toBeInTheDocument();
      expect(screen.getByLabelText("Export Format")).toBeInTheDocument();
    });

    it("renders video source dropzone when no file selected", () => {
      render(<BgRemovePanel activeTab="video" />);
      expect(screen.getByText("No file selected")).toBeInTheDocument();
    });

    it("video action button is disabled initially", () => {
      render(<BgRemovePanel activeTab="video" />);
      const btn = screen.getByRole("button", { name: "Remove Background" });
      expect(btn).toBeDisabled();
    });
  });

  describe("Image Isolate Tab", () => {
    it("renders image panel header and instructions", () => {
      render(<BgRemovePanel activeTab="image" />);
      expect(screen.getByText("One-Click Image Background Removal")).toBeInTheDocument();
      expect(screen.getByText(/Isolate anime characters/)).toBeInTheDocument();
    });

    it("renders image dropzone instructions and select button", () => {
      render(<BgRemovePanel activeTab="image" />);
      expect(screen.getByText("Drop image to remove background")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Select Image" })).toBeInTheDocument();
    });
  });
});
