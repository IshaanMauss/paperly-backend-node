const cloudinary = require("cloudinary").v2;

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

const normalizeBase64Image = (base64String) => {
  if (!base64String || typeof base64String !== "string") {
    throw new Error("Diagram image must be a base64 string.");
  }

  const trimmed = base64String.trim();
  if (!trimmed) {
    throw new Error("Diagram image base64 cannot be empty.");
  }

  if (trimmed.startsWith("data:image")) return trimmed;
  return `data:image/png;base64,${trimmed}`;
};

const uploadBase64Image = async (base64String) => {
  const dataUri = normalizeBase64Image(base64String);
  const result = await cloudinary.uploader.upload(dataUri, {
    folder: "paperly_diagrams",
    resource_type: "image",
  });
  return result.secure_url;
};

module.exports = { uploadBase64Image };
