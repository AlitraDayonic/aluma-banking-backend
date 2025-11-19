// middleware/roleCheck.js

const checkRole = (allowedRoles) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required'
      });
    }

    const userRole = req.user.role;
    
    // Convert role number to string if needed
    // 1 = admin, 2 = super_admin (adjust based on your system)
    let roleString = userRole;
    
    if (typeof userRole === 'number') {
      const roleMap = {
        1: 'admin',
        2: 'super_admin',
        // Add more role mappings if needed
      };
      roleString = roleMap[userRole] || null;
    }
    
    // Check if user role is in allowed roles
    const hasPermission = allowedRoles.includes(roleString) || 
                         allowedRoles.includes(userRole) ||
                         allowedRoles.includes(String(userRole));
    
    if (!hasPermission) {
      return res.status(403).json({
        success: false,
        message: 'Insufficient permissions'
      });
    }

    next();
  };
};

module.exports = { checkRole };
